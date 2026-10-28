package journal

import (
	"encoding/json"
	"strings"
)

// Kimi's wire/file.py persists {timestamp,message:{type,payload}}. Context
// files contain system instructions; only replayable wire events belong here.
func parseKimiTrace(line []byte) []parsedEvent {
	var item struct {
		Timestamp json.RawMessage `json:"timestamp"`
		Message   struct {
			Type    string `json:"type"`
			Payload struct {
				UserInput   json.RawMessage                  `json:"user_input"`
				Text        string                           `json:"text"`
				Think       string                           `json:"think"`
				ID          string                           `json:"id"`
				Function    struct{ Name, Arguments string } `json:"function"`
				ToolCallID  string                           `json:"tool_call_id"`
				ReturnValue struct {
					IsError bool            `json:"is_error"`
					Output  json.RawMessage `json:"output"`
					Message string          `json:"message"`
				} `json:"return_value"`
			} `json:"payload"`
		} `json:"message"`
	}
	if json.Unmarshal(line, &item) != nil {
		return nil
	}
	p := item.Message.Payload
	record := storeRecord{At: recordTime(item.Timestamp)}
	switch item.Message.Type {
	case "TurnBegin", "SteerInput":
		record.Kind, record.Text = storeUser, kimiText(p.UserInput)
	case "TextPart":
		record.Kind, record.Text = storeAssistant, p.Text
	case "ThinkPart":
		record.Kind, record.Text = storeThinking, p.Think
	case "ToolCall":
		record.Kind, record.Call, record.Name, record.Input = storeTool, p.ID, p.Function.Name, p.Function.Arguments
	case "ToolResult":
		if p.ToolCallID == "" {
			return nil
		}
		record.Kind, record.Call, record.Output, record.State = storeResult, p.ToolCallID, kimiText(p.ReturnValue.Output), "done"
		if record.Output == "" {
			record.Output = p.ReturnValue.Message
		}
		if p.ReturnValue.IsError {
			record.State = "error"
		}
	case "StepInterrupted":
		record.Kind = storeInterrupt
	case "CompactionEnd":
		record.Kind = storeCompaction
	default:
		return nil
	}
	events := nativeRecordEvents(record)
	if record.Kind == storeAssistant || record.Kind == storeThinking {
		for i := range events {
			events[i].mergeKey = "kimi:" + record.Kind
		}
	}
	return events
}

func parseKimi(line []byte) (Message, bool) { return nativeHistory(parseKimiTrace(line)) }

func kimiText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var parts []struct{ Type, Text string }
	if json.Unmarshal(raw, &parts) != nil {
		return ""
	}
	var texts []string
	for _, part := range parts {
		if part.Type == "text" && part.Text != "" {
			texts = append(texts, part.Text)
		}
	}
	return strings.Join(texts, "\n")
}
