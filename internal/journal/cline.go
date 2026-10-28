package journal

import (
	"encoding/json"
	"regexp"
	"strings"
)

// Cline SDK session-data.ts version 1 persists display metadata alongside
// canonical messages. Do not read system_prompt or synthetic user records.
func parseClineSession(data []byte, id string) ([]storeRecord, Title, error) {
	var session struct {
		Version   int    `json:"version"`
		SessionID string `json:"sessionId"`
		Agent     string `json:"agent"`
		Messages  []struct {
			Role      string          `json:"role"`
			SessionID string          `json:"sessionId"`
			Content   json.RawMessage `json:"content"`
			TS        json.RawMessage `json:"ts"`
			Metadata  struct {
				Kind        string `json:"kind"`
				DisplayRole string `json:"displayRole"`
				UserRunSpan *int   `json:"userRunSpan"`
			} `json:"metadata"`
		} `json:"messages"`
	}
	if json.Unmarshal(data, &session) != nil || session.Version != 1 || session.SessionID != id || session.Agent != "lead" {
		return nil, Title{}, ErrUnavailable
	}
	var records []storeRecord
	for _, m := range session.Messages {
		if m.SessionID != "" && m.SessionID != id {
			return nil, Title{}, ErrUnavailable
		}
		if m.Role != "user" && m.Role != "assistant" {
			continue
		}
		switch m.Metadata.DisplayRole {
		case "system", "status", "error":
			continue
		}
		var blocks []map[string]json.RawMessage
		var text string
		if json.Unmarshal(m.Content, &text) == nil {
			value, _ := json.Marshal(text)
			blocks = []map[string]json.RawMessage{{"type": json.RawMessage(`"text"`), "text": value}}
		} else if json.Unmarshal(m.Content, &blocks) != nil {
			continue
		}
		if m.Role == "user" {
			for _, block := range blocks {
				if string(block["type"]) != `"text"` {
					continue
				}
				if m.Metadata.Kind != "" || (m.Metadata.UserRunSpan != nil && *m.Metadata.UserRunSpan == 0) {
					block["text"] = json.RawMessage(`""`)
					continue
				}
				if json.Unmarshal(block["text"], &text) == nil {
					block["text"], _ = json.Marshal(clineUserText(text))
				}
			}
		}
		raw, _ := json.Marshal(map[string]any{"type": m.Role, "message": map[string]any{"role": m.Role, "content": blocks}})
		for _, event := range parseClaudeTrace(raw) {
			record := storeRecord{Kind: event.Type, Text: event.Text, Name: event.Name, Call: event.call, Input: event.Input, Output: event.Output, State: event.State, At: recordTime(m.TS)}
			if event.outputOnly {
				record.Kind = storeResult
			}
			records = append(records, record)
		}
	}
	return records, Title{Prompt: firstStorePrompt(records)}, nil
}

var clineInputWrapper = regexp.MustCompile(`(?s)<user_input\b[^>]*>(.*?)</user_input>`)

func clineUserText(text string) string {
	if match := clineInputWrapper.FindStringSubmatch(text); len(match) == 2 {
		return strings.TrimSpace(match[1])
	}
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "[TASK RESUMPTION]") || text == "The user approved switching to act mode. Continue with the approved plan now." || strings.HasPrefix(text, "<") {
		return ""
	}
	return visibleCodexUserText(text)
}
