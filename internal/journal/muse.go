package journal

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// Muse's session stream also contains background task and memory runs. A run
// belongs to chat only when a main-surface user intent names it.
func parseMuseSession(data []byte, id string) ([]storeRecord, Title, error) {
	var records []storeRecord
	runs := map[string]bool{}
	failures := map[string]bool{}
	seen := map[string]bool{}
	var sequence int64
	err := nativeLines(data, func(line []byte) error {
		var row struct {
			Schema     int                       `json:"schema_version"`
			ID         string                    `json:"id"`
			Sequence   int64                     `json:"sequence"`
			At         int64                     `json:"recorded_at"`
			Stream     struct{ Kind, ID string } `json:"stream"`
			RecordType string                    `json:"record_type"`
			Type       string                    `json:"payload_type"`
			Payload    struct {
				Kind            string                        `json:"kind"`
				RunID           string                        `json:"run_id"`
				IntentID        string                        `json:"intent_id"`
				SourceSessionID string                        `json:"source_session_id"`
				Surface         string                        `json:"surface"`
				Semantic        struct{ Kind string }         `json:"semantic_kind"`
				Refill          []struct{ Kind, Text string } `json:"refill_blocks"`
				Record          struct {
					CallID  string                `json:"call_id"`
					Outcome struct{ Kind string } `json:"outcome"`
				} `json:"record"`
				Event struct {
					Kind, Text string
					ToolCalls  []struct {
						CallID string `json:"call_id"`
						Name   string `json:"name"`
						Args   string `json:"args"`
					} `json:"tool_calls"`
					Results []struct {
						CallID string `json:"tool_call_id"`
						Text   string `json:"text"`
					} `json:"results"`
				} `json:"event"`
			} `json:"payload"`
		}
		if json.Unmarshal(line, &row) != nil || row.Schema != 1 || row.Stream.Kind != "session" || row.Stream.ID != id || row.Sequence <= sequence || row.ID == "" || seen[row.ID] {
			return ErrUnavailable
		}
		// Retained frames need a different replay contract; do not expose an
		// incomplete chat as a successfully parsed session.
		if row.RecordType != "event" && row.RecordType != "retained_marker" {
			return ErrUnavailable
		}
		sequence = row.Sequence
		seen[row.ID] = true
		at := row.At / 1000
		p := row.Payload
		switch row.Type {
		case "runtime.user_intent.accepted":
			if p.SourceSessionID != id || p.Surface != "main" || p.Semantic.Kind != "chat" || p.IntentID == "" {
				return nil
			}
			var texts []string
			for _, b := range p.Refill {
				if b.Kind == "text" {
					texts = append(texts, b.Text)
				}
			}
			text := visibleCodexUserText(strings.Join(texts, "\n"))
			if text == "" {
				return nil
			}
			runs[p.IntentID] = true
			records = append(records, storeRecord{Kind: storeUser, Text: text, At: at})
		case "tool_batch.effect.terminal":
			if runs[p.RunID] {
				failures[p.Record.CallID] = p.Record.Outcome.Kind == "failed" || p.Record.Outcome.Kind == "cancelled"
			}
		case "runtime.session":
			if p.Kind != "run" || !runs[p.RunID] {
				return nil
			}
			switch p.Event.Kind {
			case "assistant_message_committed":
				records = append(records, storeRecord{Kind: storeAssistant, Text: p.Event.Text, At: at})
			case "assistant_tool_calls_committed":
				for _, call := range p.Event.ToolCalls {
					records = append(records, storeRecord{Kind: storeTool, Call: call.CallID, Name: call.Name, Input: call.Args, At: at})
				}
			case "tool_result_batch_committed":
				for _, result := range p.Event.Results {
					state := "done"
					if failures[result.CallID] {
						state = "error"
					}
					records = append(records, storeRecord{Kind: storeResult, Call: result.CallID, Output: result.Text, State: state, At: at})
				}
			}
		}
		return nil
	})
	return records, Title{Prompt: firstStorePrompt(records)}, err
}

func (r *Reader) museTitle(ref Ref) (Title, bool) {
	title, ok := r.nativeStoreTitle(ref)
	db, err := verifiedRegular(r.NativeRoots[ref.Agent], filepath.Join(r.NativeRoots[ref.Agent], "session-index.db"))
	if err != nil {
		return title, ok
	}
	query := r.sqlite
	if query == nil {
		query = runSQLite
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	raw, err := query(ctx, db, fmt.Sprintf("select session_id,substr(title,1,256) as title from sessions where session_id='%s' limit 1;", ref.Value))
	var rows []struct {
		ID    string `json:"session_id"`
		Title string `json:"title"`
	}
	if err == nil && len(raw) < 4096 && json.Unmarshal(raw, &rows) == nil && len(rows) == 1 && rows[0].ID == ref.Value {
		title.Name = titleText(rows[0].Title, 256)
	}
	return title, ok
}
