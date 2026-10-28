package journal

import (
	"encoding/json"
	"slices"
	"strings"
)

// Qwen's chatRecordingService stores a parentUuid chain. A rewind changes the
// parent of the new record, leaving abandoned turns in the file. Follow only
// the active branch, and use systemPayload.displayText for real submissions.
type qwenRecord struct {
	UUID                  string          `json:"uuid"`
	ParentUUID            *string         `json:"parentUuid"`
	SessionID             string          `json:"sessionId"`
	Type                  string          `json:"type"`
	Subtype               string          `json:"subtype"`
	Provenance            string          `json:"provenance"`
	AgentID               string          `json:"agentId"`
	ClientInitiatedSkills bool            `json:"clientInitiatedSkills"`
	Timestamp             json.RawMessage `json:"timestamp"`
	Message               struct {
		Parts []qwenPart `json:"parts"`
	} `json:"message"`
	SystemPayload struct {
		DisplayText *string `json:"displayText"`
		CustomTitle string  `json:"customTitle"`
	} `json:"systemPayload"`
	ToolCallResult struct {
		CallID string          `json:"callId"`
		Error  json.RawMessage `json:"error"`
		Status string          `json:"status"`
	} `json:"toolCallResult"`
}

type qwenPart struct {
	Text         string `json:"text"`
	Thought      bool   `json:"thought"`
	FunctionCall *struct {
		ID, Name string
		Args     json.RawMessage
	} `json:"functionCall"`
	FunctionResponse *struct {
		ID, Name string
		Response json.RawMessage
	} `json:"functionResponse"`
}

func parseQwenSession(data []byte, id string) ([]storeRecord, Title, error) {
	rows := map[string]qwenRecord{}
	var last string
	var title Title
	err := nativeLines(data, func(line []byte) error {
		var row qwenRecord
		if json.Unmarshal(line, &row) != nil || row.SessionID != id || row.UUID == "" {
			return ErrUnavailable
		}
		// Managed sessions use a different transaction format. Never guess their
		// commit boundaries from records resembling the legacy format.
		if strings.HasPrefix(row.Subtype, "managed_session_") {
			return ErrUnavailable
		}
		if _, exists := rows[row.UUID]; exists {
			return ErrUnavailable
		}
		rows[row.UUID] = row
		last = row.UUID
		if row.Type == "system" && row.Subtype == "custom_title" {
			title.Name = titleText(row.SystemPayload.CustomTitle, 256)
		}
		return nil
	})
	if err != nil {
		return nil, Title{}, err
	}
	var branch []qwenRecord
	seen := map[string]bool{}
	for last != "" {
		row, ok := rows[last]
		if !ok || seen[last] {
			return nil, Title{}, ErrUnavailable
		}
		seen[last] = true
		branch = append(branch, row)
		last = ""
		if row.ParentUUID != nil {
			last = *row.ParentUUID
		}
	}
	slices.Reverse(branch)
	var records []storeRecord
	for _, row := range branch {
		records = append(records, qwenRecords(row)...)
	}
	title.Prompt = firstStorePrompt(records)
	return records, title, nil
}

func qwenRecords(row qwenRecord) []storeRecord {
	if row.AgentID != "" || row.ClientInitiatedSkills {
		return nil
	}
	at := recordTime(row.Timestamp)
	if row.Type == "user" {
		if (row.Provenance != "" && row.Provenance != "real_user") || (row.Subtype != "" && row.Subtype != "mid_turn_user_message") {
			return nil
		}
		var text string
		if row.SystemPayload.DisplayText != nil {
			text = *row.SystemPayload.DisplayText
		} else {
			var parts []string
			for _, p := range row.Message.Parts {
				if !p.Thought && p.Text != "" {
					parts = append(parts, visibleCodexUserText(p.Text))
				}
			}
			text = strings.Join(parts, "\n")
		}
		text = strings.TrimSpace(text)
		if text == "" || strings.HasPrefix(text, "<") || strings.HasPrefix(text, "# AGENTS.md") {
			return nil
		}
		return []storeRecord{{Kind: storeUser, Text: text, At: at}}
	}
	var records []storeRecord
	for _, p := range row.Message.Parts {
		if row.Type == "assistant" {
			if p.Text != "" {
				kind := storeAssistant
				if p.Thought {
					kind = storeThinking
				}
				records = append(records, storeRecord{Kind: kind, Text: p.Text, At: at})
			}
			if call := p.FunctionCall; call != nil && toolName.MatchString(call.Name) {
				records = append(records, storeRecord{Kind: storeTool, Name: call.Name, Call: call.ID, Input: string(call.Args), At: at})
			}
		}
		if response := p.FunctionResponse; row.Type == "tool_result" && response != nil {
			call := response.ID
			if call == "" {
				call = row.ToolCallResult.CallID
			}
			if call == "" {
				continue
			}
			state := "done"
			if row.ToolCallResult.Status == "error" || row.ToolCallResult.Status == "cancelled" || (len(row.ToolCallResult.Error) > 0 && string(row.ToolCallResult.Error) != "null") {
				state = "error"
			}
			records = append(records, storeRecord{Kind: storeResult, Call: call, Output: string(response.Response), State: state, At: at})
		}
	}
	return records
}
