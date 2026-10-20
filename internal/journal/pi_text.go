package journal

// Renders a Pi session tree into the chat vocabulary: message text, the
// generated wrappers a chat must drop, and the active branch as events.

import (
	"encoding/json"
	"regexp"
	"strings"
)

func piText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var blocks []piBlock
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}
	var parts []string
	for _, block := range blocks {
		if block.Type == "text" && block.Text != "" {
			parts = append(parts, block.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// Pi writes each attached file as a leading generated wrapper: an empty one for
// an image block, or the file's text between the tags. Only that wrapper is
// dropped; the request after it is the user's message.
var piFileReference = regexp.MustCompile(`^<file name="[^"\r\n]*">[\s\S]*?</file>`)

// A /skill:<name> prompt is stored as the skill's whole instruction body in a
// generated wrapper, with whatever the user typed after it. The body is model
// context, never a chat bubble.
var piSkillBlock = regexp.MustCompile(`^<skill name="([^"\r\n]+)" location="[^"\r\n]*">\n[\s\S]*?\n</skill>(?:\n\n([\s\S]*))?$`)

// Pi appends an image's dimensions to the prompt so the model can map
// coordinates. Like the attachment wrapper, it is generated, never typed.
var piImageHint = regexp.MustCompile(`(?:\n\n|\n|^)(?:\[Image: original [^\]\r\n]*\]\n?)+$`)

// piUserText is what a chat shows for a user message: the request without the
// attachment wrappers the phone cannot open, an image's dimension hint, and a
// skill invocation in its typed form instead of the skill body.
func piUserText(raw json.RawMessage) string {
	text := strings.TrimLeft(piText(raw), " \t\r\n")
	for {
		loc := piFileReference.FindStringIndex(text)
		if loc == nil {
			break
		}
		text = strings.TrimLeft(text[loc[1]:], " \t\r\n")
	}
	text = strings.TrimSpace(piImageHint.ReplaceAllString(text, ""))
	match := piSkillBlock.FindStringSubmatch(text)
	if match == nil {
		return text
	}
	invocation := "/skill:" + strings.TrimSpace(match[1])
	if args := strings.TrimSpace(match[2]); args != "" {
		return invocation + " " + args
	}
	return invocation
}

// piEvents renders the active branch. withModels adds each assistant record's
// model and thinking level (TraceOptions.Models). A failed request shows its
// error only when no later assistant record supersedes it: Pi retries a
// stalled request by appending the retry, so the error is not a turn end.
func piEvents(session *piSession, withModels bool) []parsedEvent {
	var out []parsedEvent
	tools := map[string]int{}
	errorAt := -1
	dropError := func() {
		if errorAt >= 0 {
			out = append(out[:errorAt], out[errorAt+1:]...)
			errorAt = -1
		}
	}
	for ordinal, entry := range session.branch {
		eventOrdinal := 0
		add := func(event parsedEvent) {
			event.lineStart = ordinal
			event.sourceOrdinal = eventOrdinal
			event.At = recordTime(entry.Timestamp)
			eventOrdinal++
			out = append(out, event)
		}
		switch entry.Type {
		case "compaction":
			add(parsedEvent{Event: Event{Type: EventCompaction}})
		case "custom_message":
			if text := piText(entry.Content); entry.Display && text != "" {
				add(parsedEvent{Event: Event{Type: "assistant", Text: "[Extension] " + text}})
			}
		case "message":
			var msg piMessage
			if json.Unmarshal(entry.Message, &msg) != nil {
				continue
			}
			var models []TraceModel
			if withModels {
				models = traceModel(msg.Model, msg.ThinkingLevel, "pi_message")
			}
			switch msg.Role {
			case "user":
				// The next prompt opens a new turn; a previous error stands.
				errorAt = -1
				if text := piUserText(msg.Content); text != "" {
					add(parsedEvent{Event: Event{Type: "user", Text: text}})
				}
			case "bashExecution":
				// A `!command` the user ran in the TUI; the chat shows it like
				// Claude's shell command, and it is not model work.
				if command := strings.TrimSpace(msg.Command); command != "" {
					add(parsedEvent{Event: Event{Type: EventCommand, Text: "! " + command}})
				}
			case "assistant":
				dropError()
				var blocks []piBlock
				if json.Unmarshal(msg.Content, &blocks) != nil {
					continue
				}
				for _, block := range blocks {
					switch block.Type {
					case "text":
						if block.Text != "" {
							add(parsedEvent{Event: Event{Type: "assistant", Text: block.Text, Models: models}})
						}
					case "thinking":
						if block.Thinking != "" {
							add(parsedEvent{Event: Event{Type: "thinking", Text: block.Thinking, Models: models}})
						}
					case "toolCall":
						if toolName.MatchString(block.Name) && block.ID != "" {
							add(parsedEvent{Event: Event{Type: "tool", Name: block.Name, Input: compactJSON(block.Arguments), Models: models}, call: block.ID})
							tools[block.ID] = len(out) - 1
						}
					}
				}
				if msg.StopReason == "aborted" {
					add(parsedEvent{Event: Event{Type: EventInterrupt}})
				}
				if errText := strings.TrimSpace(msg.ErrorMessage); msg.StopReason == "error" && errText != "" {
					errorAt = len(out)
					add(parsedEvent{Event: Event{Type: "assistant", Text: errText, Models: models}})
				}
			case "toolResult":
				if index, ok := tools[msg.ToolCallID]; ok {
					out[index].Output = piText(msg.Content)
					if msg.IsError {
						out[index].State = "error"
					} else {
						out[index].State = "done"
					}
				}
			}
		}
	}
	return out
}
