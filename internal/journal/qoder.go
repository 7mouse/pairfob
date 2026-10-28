package journal

import "encoding/json"

// Qoder's project transcript uses user/assistant records with Anthropic
// blocks. Every explicit native ID must agree with the exact filename binding.
func parseQoderSession(data []byte, id string) ([]storeRecord, Title, error) {
	var records []storeRecord
	var title Title
	err := nativeLines(data, func(line []byte) error {
		var row struct {
			SessionID    string          `json:"sessionId"`
			SessionSnake string          `json:"session_id"`
			Type         string          `json:"type"`
			Timestamp    json.RawMessage `json:"timestamp"`
		}
		if json.Unmarshal(line, &row) != nil {
			return ErrUnavailable
		}
		if (row.SessionID != "" && row.SessionID != id) || (row.SessionSnake != "" && row.SessionSnake != id) {
			return ErrUnavailable
		}

		records = append(records, recordsFromEvents(parseClaudeTrace(line), recordTime(row.Timestamp))...)
		return nil
	})
	title.Prompt = firstStorePrompt(records)
	return records, title, err
}
