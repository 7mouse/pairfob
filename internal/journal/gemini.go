package journal

import (
	"bufio"
	"encoding/json"
	"io"
	"path/filepath"
	"slices"
	"strings"
)

// Shapes follow google-gemini/gemini-cli chatRecordingTypes.ts. Both legacy
// JSON sessions and JSONL edits are supported; filenames contain only 8 ID
// characters, so the full sessionId in metadata is mandatory.
type geminiMessage struct {
	ID             string                                        `json:"id"`
	Type           string                                        `json:"type"`
	Timestamp      json.RawMessage                               `json:"timestamp"`
	Content        json.RawMessage                               `json:"content"`
	DisplayContent json.RawMessage                               `json:"displayContent"`
	ToolCalls      []geminiTool                                  `json:"toolCalls"`
	Thoughts       []struct{ Text, Subject, Description string } `json:"thoughts"`
}

type geminiTool struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Args      json.RawMessage `json:"args"`
	Result    json.RawMessage `json:"result"`
	Status    string          `json:"status"`
	Timestamp json.RawMessage `json:"timestamp"`
	AgentID   string          `json:"agentId"`
}

type geminiConversation struct {
	SessionID string          `json:"sessionId"`
	Kind      string          `json:"kind"`
	Summary   string          `json:"summary"`
	Messages  []geminiMessage `json:"messages"`
}

func (r *Reader) geminiTranscriptPath(ref Ref) (string, error) {
	root := r.NativeRoots[ref.Agent]
	var found string
	for _, ext := range []string{"json", "jsonl"} {
		paths, _ := filepath.Glob(filepath.Join(root, "tmp", "*", "chats", "session-*-"+ref.Value[:8]+"."+ext))
		if len(paths) > 32 {
			return "", ErrUnavailable
		}
		for _, path := range paths {
			file, err := openActivityFile(root, path)
			if err != nil {
				continue
			}
			var meta geminiConversation
			if ext == "jsonl" {
				scanner := bufio.NewScanner(io.LimitReader(file, 64<<10))
				scanner.Buffer(make([]byte, 4096), maxTranscriptLine)
				if scanner.Scan() {
					_ = json.Unmarshal(scanner.Bytes(), &meta)
				}
			} else {
				meta.SessionID = geminiJSONIdentity(io.LimitReader(file, 64<<10))
			}
			file.Close()
			if meta.SessionID != ref.Value || meta.Kind == "subagent" {
				continue
			}
			if found != "" {
				return "", ErrUnavailable
			}
			found = path
		}
	}
	if found == "" {
		return "", ErrUnavailable
	}
	return verifiedRegular(root, found)
}

func parseGeminiSession(data []byte, id string, jsonl bool) ([]storeRecord, Title, error) {
	var session geminiConversation
	var err error
	if jsonl {
		session, err = decodeGeminiLines(data, id)
	} else {
		err = json.Unmarshal(data, &session)
	}
	if err != nil || session.SessionID != id || session.Kind == "subagent" {
		return nil, Title{}, ErrUnavailable
	}
	var records []storeRecord
	for _, message := range session.Messages {
		records = append(records, geminiRecords(message)...)
	}
	return records, Title{Name: titleText(session.Summary, 256), Prompt: firstStorePrompt(records)}, nil
}

func decodeGeminiLines(data []byte, id string) (geminiConversation, error) {
	var session geminiConversation
	messages := map[string]geminiMessage{}
	var order []string
	put := func(m geminiMessage) {
		if m.ID != "" {
			if _, ok := messages[m.ID]; !ok {
				order = append(order, m.ID)
			}
			messages[m.ID] = m
		}
	}
	apply := func(raw json.RawMessage) {
		var p struct {
			ID        string
			Content   json.RawMessage
			ToolCalls []struct {
				ID     string
				Result json.RawMessage
			}
		}
		if json.Unmarshal(raw, &p) != nil {
			return
		}
		m, ok := messages[p.ID]
		if !ok {
			return
		}
		if p.Content != nil {
			m.Content = p.Content
		}
		for _, patch := range p.ToolCalls {
			for i := range m.ToolCalls {
				if m.ToolCalls[i].ID == patch.ID && patch.Result != nil {
					m.ToolCalls[i].Result = patch.Result
				}
			}
		}
		messages[p.ID] = m
	}
	err := nativeLines(data, func(line []byte) error {
		var row map[string]json.RawMessage
		if json.Unmarshal(line, &row) != nil {
			return ErrUnavailable
		}
		if raw, ok := row["$rewindTo"]; ok {
			var target string
			if json.Unmarshal(raw, &target) != nil {
				return ErrUnavailable
			}
			index := slices.Index(order, target)
			if index < 0 {
				index = 0
			}
			for _, key := range order[index:] {
				delete(messages, key)
			}
			order = order[:index]
		} else if raw, ok := row["$patch"]; ok {
			var patch struct {
				Updates   []json.RawMessage
				RemoveIDs []string `json:"removeIds"`
				OrderIDs  []string `json:"orderIds"`
			}
			if json.Unmarshal(raw, &patch) != nil {
				return ErrUnavailable
			}
			apply(raw)
			for _, update := range patch.Updates {
				apply(update)
			}
			for _, key := range patch.RemoveIDs {
				delete(messages, key)
			}
			order = slices.DeleteFunc(order, func(key string) bool { _, ok := messages[key]; return !ok })
			if patch.OrderIDs != nil {
				var suffix []string
				seen := map[string]bool{}
				for _, key := range patch.OrderIDs {
					if _, ok := messages[key]; ok && !seen[key] {
						suffix = append(suffix, key)
						seen[key] = true
					}
				}
				order = append(slices.DeleteFunc(order, func(key string) bool { return seen[key] }), suffix...)
			}
		} else if raw, ok := row["$set"]; ok {
			var set map[string]json.RawMessage
			if json.Unmarshal(raw, &set) != nil {
				return ErrUnavailable
			}
			if v, ok := set["sessionId"]; ok {
				var got string
				if json.Unmarshal(v, &got) != nil || got != id {
					return ErrUnavailable
				}
			}
			if v, ok := set["kind"]; ok {
				if json.Unmarshal(v, &session.Kind) != nil {
					return ErrUnavailable
				}
			}
			if v, ok := set["summary"]; ok {
				if json.Unmarshal(v, &session.Summary) != nil {
					return ErrUnavailable
				}
			}
			if v, ok := set["messages"]; ok {
				var list []geminiMessage
				if json.Unmarshal(v, &list) != nil {
					return ErrUnavailable
				}
				clear(messages)
				order = nil
				for _, m := range list {
					put(m)
				}
			}
		} else if raw, ok := row["sessionId"]; ok {
			var got string
			if json.Unmarshal(raw, &got) != nil || got != id || session.SessionID != "" {
				return ErrUnavailable
			}
			if json.Unmarshal(line, &session) != nil {
				return ErrUnavailable
			}
			for _, m := range session.Messages {
				put(m)
			}
		} else {
			var m geminiMessage
			if json.Unmarshal(line, &m) != nil {
				return ErrUnavailable
			}
			put(m)
		}
		return nil
	})
	session.Messages = nil
	for _, key := range order {
		session.Messages = append(session.Messages, messages[key])
	}
	return session, err
}

func geminiRecords(m geminiMessage) []storeRecord {
	at := recordTime(m.Timestamp)
	var records []storeRecord
	switch m.Type {
	case "user":
		content := m.Content
		if m.DisplayContent != nil {
			content = m.DisplayContent
		}
		text := geminiText(content)
		trimmed := strings.TrimSpace(text)
		if trimmed == "" || strings.HasPrefix(trimmed, "/") || strings.HasPrefix(trimmed, "?") || strings.HasPrefix(trimmed, "<session_context>") || strings.HasPrefix(trimmed, "<hook_context>") {
			return nil
		}
		return []storeRecord{{Kind: storeUser, Text: text, At: at}}
	case "gemini":
		for _, thought := range m.Thoughts {
			text := thought.Text
			if text == "" {
				text = strings.TrimSpace(thought.Subject + "\n" + thought.Description)
			}
			if text != "" {
				records = append(records, storeRecord{Kind: storeThinking, Text: text, At: at})
			}
		}
		if text := geminiText(m.Content); text != "" {
			records = append(records, storeRecord{Kind: storeAssistant, Text: text, At: at})
		}
		for _, tool := range m.ToolCalls {
			if tool.AgentID != "" || !toolName.MatchString(tool.Name) {
				continue
			}
			record := storeRecord{Kind: storeTool, Name: tool.Name, Call: tool.ID, Input: string(tool.Args), At: recordTime(tool.Timestamp)}
			if record.At == 0 {
				record.At = at
			}
			switch tool.Status {
			case "success":
				record.State = "done"
			case "error", "cancelled":
				record.State = "error"
			}
			record.Output = geminiText(tool.Result)
			records = append(records, record)
		}
	}
	return records
}

func geminiText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var parts []json.RawMessage
	if json.Unmarshal(raw, &parts) != nil {
		parts = []json.RawMessage{raw}
	}
	var texts []string
	for _, part := range parts {
		if json.Unmarshal(part, &text) == nil {
			if text != "" {
				texts = append(texts, text)
			}
			continue
		}
		var p struct {
			Text    string
			Thought bool
		}
		if json.Unmarshal(part, &p) == nil && !p.Thought && p.Text != "" {
			texts = append(texts, p.Text)
		}
	}
	return strings.Join(texts, "\n")
}

// Legacy JSON starts with metadata, before the potentially huge messages array.
func geminiJSONIdentity(reader io.Reader) string {
	decoder := json.NewDecoder(reader)
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return ""
	}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return ""
		}
		if key == "sessionId" {
			var id string
			if decoder.Decode(&id) == nil {
				return id
			}
			return ""
		}
		var ignored json.RawMessage
		if decoder.Decode(&ignored) != nil {
			return ""
		}
	}
	return ""
}
