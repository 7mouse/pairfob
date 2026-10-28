package journal

import (
	"encoding/json"
	"path/filepath"
	"strings"
)

func (r *Reader) kiroTranscriptPath(ref Ref) (string, error) {
	root := r.NativeRoots[ref.Agent]
	var found []string
	for _, dir := range []string{ref.Value, "sess_" + ref.Value} {
		paths, _ := filepath.Glob(filepath.Join(root, "sessions", "*", dir, "messages.jsonl"))
		found = append(found, paths...)
	}
	if len(found) != 1 {
		return "", ErrUnavailable
	}
	return verifiedRegular(root, found[0])
}

func (r *Reader) parseKiroSession(data []byte, ref Ref, path string) ([]storeRecord, Title, error) {
	var meta struct {
		ID, Title string
		Schema    string `json:"schemaVersion"`
		Version   int    `json:"dataModelVersion"`
	}
	if !readTitleJSON(r.NativeRoots[ref.Agent], filepath.Join(filepath.Dir(path), "session.json"), &meta) || (meta.ID != ref.Value && meta.ID != "sess_"+ref.Value) || meta.Schema != "1.0.0" || meta.Version != 1 {
		return nil, Title{}, ErrUnavailable
	}
	var records []storeRecord
	err := nativeLines(data, func(line []byte) error {
		var row struct {
			Timestamp json.RawMessage `json:"timestamp"`
			Payload   struct {
				Type      string          `json:"type"`
				Kind      string          `json:"kind"`
				Content   json.RawMessage `json:"content"`
				Operation string          `json:"operationType"`
				Parent    string          `json:"parentExecutionId"`
				Name      string          `json:"toolName"`
				CallID    string          `json:"toolCallId"`
				Args      json.RawMessage `json:"args"`
				Success   *bool           `json:"success"`
				Meta      struct {
					Kiro struct {
						Synthetic json.RawMessage `json:"syntheticUserMessageReason"`
						Cleared   json.RawMessage `json:"steeringClearedIds"`
					} `json:"kiro"`
				} `json:"_meta"`
			} `json:"payload"`
		}
		if json.Unmarshal(line, &row) != nil || row.Payload.Type == "" {
			return ErrUnavailable
		}
		p := row.Payload
		if p.Parent != "" {
			return nil
		}
		record := storeRecord{At: recordTime(row.Timestamp), Text: kimiText(p.Content)}
		switch p.Type {
		case "user":
			if len(p.Meta.Kiro.Synthetic) > 0 || len(p.Meta.Kiro.Cleared) > 0 {
				return nil
			}
			record.Kind = storeUser
			record.Text = visibleCodexUserText(record.Text)
		case "assistant":
			record.Kind = storeAssistant
			if p.Operation == "Reasoning" {
				record.Kind = storeThinking
				if strings.TrimSpace(record.Text) == "..." {
					return nil
				}
			}
		case "tombstone":
			if p.Kind != "summarization" {
				return ErrUnavailable
			}
			record.Kind = storeCompaction
			record.Text = ""
		case "tool_call":
			record.Kind, record.Call, record.Name, record.Input = storeTool, p.CallID, p.Name, string(p.Args)
		case "tool_result":
			record.Kind, record.Call, record.Output = storeResult, p.CallID, record.Text
			record.Text = ""
			record.State = "done"
			if p.Success != nil && !*p.Success {
				record.State = "error"
			}
		default:
			return nil
		}
		records = append(records, record)
		return nil
	})
	return records, Title{Name: titleText(meta.Title, 256), Prompt: firstStorePrompt(records)}, err
}
