package journal

import (
	"encoding/json"
	"strings"
)

// Amp persists a complete thread document; tools use toolUseID and run rather
// than Anthropic's tool_use_id/is_error fields.
func parseAmpSession(data []byte, id string) ([]storeRecord, Title, error) {
	var thread struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Messages []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
			Meta    struct {
				SentAt json.RawMessage `json:"sentAt"`
			} `json:"meta"`
			Usage struct {
				Timestamp json.RawMessage `json:"timestamp"`
			} `json:"usage"`
		} `json:"messages"`
	}
	if json.Unmarshal(data, &thread) != nil || thread.ID != id {
		return nil, Title{}, ErrUnavailable
	}
	var records []storeRecord
	for _, m := range thread.Messages {
		at := recordTime(m.Meta.SentAt)
		if at == 0 {
			at = recordTime(m.Usage.Timestamp)
		}
		var blocks []map[string]json.RawMessage
		if json.Unmarshal(m.Content, &blocks) != nil {
			records = append(records, anthropicRecords(m.Role, m.Content, at)...)
			continue
		}
		for _, b := range blocks {
			if string(b["type"]) != `"tool_result"` {
				continue
			}
			b["tool_use_id"] = b["toolUseID"]
			var run struct {
				Status string          `json:"status"`
				Result json.RawMessage `json:"result"`
			}
			if json.Unmarshal(b["run"], &run) == nil {
				if run.Status != "done" && run.Status != "error" && run.Status != "failed" {
					// A persisted partial result does not finish the call.
					b["type"] = json.RawMessage(`"pending_tool_result"`)
					continue
				}

				var result struct {
					Output   string `json:"output"`
					ExitCode int    `json:"exitCode"`
				}
				output := kimiText(run.Result)
				if json.Unmarshal(run.Result, &result) == nil {
					output = result.Output
				}
				var lines []string
				if json.Unmarshal(run.Result, &lines) == nil {
					output = strings.Join(lines, "\n")
				}
				if output != "" {
					b["content"], _ = json.Marshal(output)
				}
				b["is_error"], _ = json.Marshal(run.Status == "error" || run.Status == "failed" || result.ExitCode != 0)
			}
		}
		content, _ := json.Marshal(blocks)
		records = append(records, anthropicRecords(m.Role, content, at)...)
	}
	return records, Title{Name: titleText(thread.Title, 256), Prompt: firstStorePrompt(records)}, nil
}
