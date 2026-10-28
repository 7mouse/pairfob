package journal

import "encoding/json"

// github/copilot-sdk nodejs/src/generated/session-events.ts defines this
// persisted event stream. Read displayed content, never transformedContent.
type copilotEvent struct {
	Type      string          `json:"type"`
	AgentID   string          `json:"agentId"`
	Timestamp json.RawMessage `json:"timestamp"`
	Data      struct {
		Content                 string          `json:"content"`
		Source                  string          `json:"source"`
		IsAutopilotContinuation bool            `json:"isAutopilotContinuation"`
		ParentToolCallID        string          `json:"parentToolCallId"`
		ToolCallID              string          `json:"toolCallId"`
		ToolName                string          `json:"toolName"`
		Arguments               json.RawMessage `json:"arguments"`
		Success                 bool            `json:"success"`
		Result                  struct {
			Content string `json:"content"`
		} `json:"result"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	} `json:"data"`
}

func parseCopilotTrace(line []byte) []parsedEvent {
	var item copilotEvent
	if json.Unmarshal(line, &item) != nil || item.AgentID != "" || item.Data.ParentToolCallID != "" {
		return nil
	}
	d := item.Data
	record := storeRecord{At: recordTime(item.Timestamp)}
	switch item.Type {
	case "user.message":
		// Skill injection and inter-agent messages are not user submissions.
		if d.Source != "" || d.IsAutopilotContinuation {
			return nil
		}
		record.Kind, record.Text = storeUser, d.Content
	case "assistant.message":
		record.Kind, record.Text = storeAssistant, d.Content
	case "assistant.reasoning":
		record.Kind, record.Text = storeThinking, d.Content
	case "tool.execution_start":
		record.Kind, record.Name, record.Call, record.Input = storeTool, d.ToolName, d.ToolCallID, string(d.Arguments)
	case "tool.execution_complete":
		if d.ToolCallID == "" {
			return nil
		}
		record.Kind, record.Call, record.Output, record.State = storeResult, d.ToolCallID, d.Result.Content, "done"
		if !d.Success {
			record.State = "error"
			if record.Output == "" {
				record.Output = d.Error.Message
			}
		}
	case "abort":
		record.Kind = storeInterrupt
	default:
		return nil
	}
	return nativeRecordEvents(record)
}

func parseCopilot(line []byte) (Message, bool) { return nativeHistory(parseCopilotTrace(line)) }

func nativeRecordEvents(record storeRecord) []parsedEvent {
	data, err := json.Marshal(record)
	if err != nil {
		return nil
	}
	return parseStoreTrace(data)
}

func nativeHistory(events []parsedEvent) (Message, bool) {
	for _, event := range events {
		switch event.Type {
		case "user", "assistant":
			if event.Text != "" {
				return Message{Role: event.Type, Text: event.Text}, true
			}
		case "tool":
			if !event.outputOnly && toolName.MatchString(event.Name) {
				return Message{Role: "assistant", Text: "工具 · " + event.Name}, true
			}
		}
	}
	return Message{}, false
}
