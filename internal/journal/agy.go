package journal

import (
	"encoding/json"
	"sort"
)

// Antigravity CLI exports display steps under the exact brain session. Source
// distinguishes a typed request from generated context and notifications.
func parseAgySession(data []byte) ([]storeRecord, Title, error) {
	type step struct {
		Index    int             `json:"step_index"`
		Source   string          `json:"source"`
		Type     string          `json:"type"`
		Status   string          `json:"status"`
		Created  json.RawMessage `json:"created_at"`
		Content  string          `json:"content"`
		Thinking string          `json:"thinking"`
		Tools    []struct {
			Name string          `json:"name"`
			Args json.RawMessage `json:"args"`
		} `json:"tool_calls"`
	}
	steps := map[int]step{}
	err := nativeLines(data, func(line []byte) error {
		var s step
		if json.Unmarshal(line, &s) != nil || s.Index < 0 || s.Type == "" {
			return ErrUnavailable
		}
		steps[s.Index] = s
		return nil
	})
	if err != nil {
		return nil, Title{}, err
	}
	indexes := make([]int, 0, len(steps))
	for i := range steps {
		indexes = append(indexes, i)
	}
	sort.Ints(indexes)
	var records []storeRecord
	for _, i := range indexes {
		s := steps[i]
		at := recordTime(s.Created)
		if s.Type == "USER_INPUT" && s.Source == "USER_EXPLICIT" {
			text := s.Content
			if body, ok := leadingTaggedBody(text, "USER_REQUEST"); ok {
				text = body
			}
			records = append(records, storeRecord{Kind: storeUser, Text: visibleCodexUserText(text), At: at})
		}
		if s.Type == "PLANNER_RESPONSE" && s.Source == "MODEL" {
			if s.Thinking != "" {
				records = append(records, storeRecord{Kind: storeThinking, Text: s.Thinking, At: at})
			}
			if s.Content != "" {
				records = append(records, storeRecord{Kind: storeAssistant, Text: s.Content, At: at})
			}
			for _, tool := range s.Tools {
				records = append(records, storeRecord{Kind: storeTool, Name: tool.Name, Input: string(tool.Args), At: at})
			}
		}
	}
	return records, Title{Prompt: firstStorePrompt(records)}, nil
}
