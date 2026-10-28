package journal

import "encoding/json"

// The reflection transcript is produced from Letta's display lines. Its
// conversation ID, not the persistent agent ID, must be the trusted binding.
func parseLettaSession(data []byte) ([]storeRecord, Title, error) {
	var records []storeRecord
	seen := map[string]int{}
	err := nativeLines(data, func(line []byte) error {
		var row struct {
			Kind, Text, Name string
			Args             string          `json:"argsText"`
			Result           string          `json:"resultText"`
			OK               *bool           `json:"resultOk"`
			At               json.RawMessage `json:"captured_at"`
			ID               string          `json:"source_line_id"`
		}
		if json.Unmarshal(line, &row) != nil {
			return ErrUnavailable
		}
		record := storeRecord{Kind: row.Kind, Text: row.Text, At: recordTime(row.At)}
		switch row.Kind {
		case "user":
			record.Text = visibleCodexUserText(row.Text)
		case "assistant":
		case "reasoning":
			record.Kind = storeThinking
		case "error":
			record.Kind = storeAssistant
		case "tool_call":
			record.Kind, record.Name, record.Call, record.Input, record.Output = storeTool, row.Name, row.ID, row.Args, row.Result
			if row.OK != nil {
				record.State = "done"
				if !*row.OK {
					record.State = "error"
				}
			}
		default:
			return nil
		}
		if row.ID != "" {
			if index, ok := seen[row.ID]; ok {
				records[index] = record
				return nil
			}
			seen[row.ID] = len(records)
		}
		records = append(records, record)
		return nil
	})
	return records, Title{Prompt: firstStorePrompt(records)}, err
}
