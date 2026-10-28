package journal

import "encoding/json"

// Maki log versions 2/3 separate message provenance from model-facing roles.
// Frames, observations and sub_msg records must never become main-user turns.
func parseMakiSession(data []byte, id string) ([]storeRecord, Title, error) {
	var records []storeRecord
	var title Title
	started := false
	err := nativeLines(data, func(line []byte) error {
		var row struct {
			T     string `json:"t"`
			V     int    `json:"v"`
			ID    string `json:"id"`
			Title string `json:"title"`
			D     struct {
				Role        string          `json:"role"`
				Content     json.RawMessage `json:"content"`
				Kind        json.RawMessage `json:"kind"`
				DisplayText *string         `json:"display_text"`
			} `json:"d"`
		}
		if json.Unmarshal(line, &row) != nil {
			return ErrUnavailable
		}
		if row.T == "header" {
			if started || row.ID != id || row.V < 2 || row.V > 3 {
				return ErrUnavailable
			}
			started = true
			return nil
		}
		if !started {
			return ErrUnavailable
		}
		switch row.T {
		case "meta":
			title.Name = titleText(row.Title, 256)
			if title.Name == "New session" {
				title.Name = ""
			}
		case "msg":
			if len(row.D.Kind) > 0 && string(row.D.Kind) != `"turn"` && string(row.D.Kind) != "null" {
				return nil
			}
			if row.D.Role == "user" && row.D.DisplayText != nil {
				row.D.Content, _ = json.Marshal(*row.D.DisplayText)
			}
			records = append(records, anthropicRecords(row.D.Role, row.D.Content, 0)...)
		}
		return nil
	})
	if !started {
		return nil, Title{}, ErrUnavailable
	}
	title.Prompt = firstStorePrompt(records)
	return records, title, err
}
