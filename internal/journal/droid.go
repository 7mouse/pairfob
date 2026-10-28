package journal

import "encoding/json"

func parseDroidSession(data []byte, id string) ([]storeRecord, Title, error) {
	var records []storeRecord
	var title Title
	started := false
	err := nativeLines(data, func(line []byte) error {
		var row struct {
			Type      string          `json:"type"`
			ID        string          `json:"id"`
			Title     string          `json:"title"`
			Timestamp json.RawMessage `json:"timestamp"`
			Message   struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(line, &row) != nil {
			return ErrUnavailable
		}
		if row.Type == "session_start" {
			if started || row.ID != id {
				return ErrUnavailable
			}
			started = true
			title.Name = titleText(row.Title, 256)
			return nil
		}
		if !started {
			return ErrUnavailable
		}
		if row.Type == "message" {
			records = append(records, anthropicRecords(row.Message.Role, row.Message.Content, recordTime(row.Timestamp))...)
		}
		return nil
	})
	if !started {
		return nil, Title{}, ErrUnavailable
	}
	title.Prompt = firstStorePrompt(records)
	return records, title, err
}
