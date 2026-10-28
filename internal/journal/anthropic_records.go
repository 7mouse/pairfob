package journal

import "encoding/json"

// Several native stores use Anthropic content blocks. Normalize only the
// selected display message, never a surrounding prompt or tool snapshot.
func anthropicRecords(role string, content json.RawMessage, at int64) []storeRecord {
	raw, _ := json.Marshal(map[string]any{"type": role, "message": map[string]any{"role": role, "content": content}})
	return recordsFromEvents(parseClaudeTrace(raw), at)
}

func recordsFromEvents(events []parsedEvent, at int64) []storeRecord {
	records := make([]storeRecord, 0, len(events))
	for _, event := range events {
		record := storeRecord{Kind: event.Type, Text: event.Text, Name: event.Name, Call: event.call, Input: event.Input, Output: event.Output, State: event.State, At: at}
		if record.At == 0 {
			record.At = event.At
		}
		if event.outputOnly {
			record.Kind = storeResult
		}
		records = append(records, record)
	}
	return records
}
