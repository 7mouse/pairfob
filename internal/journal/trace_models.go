package journal

import (
	"encoding/json"
	"regexp"
	"slices"
)

// TraceModel is record-local evidence, never the pane's current settings.
// Codex records the requested turn context; Claude records the message model.
type TraceModel struct {
	Model  string `json:"model"`
	Effort string `json:"effort,omitempty"`
	Source string `json:"source"`
}

var modelToken = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)

func traceModel(model, effort, source string) []TraceModel {
	if !modelToken.MatchString(model) {
		return nil
	}
	if !modelToken.MatchString(effort) {
		effort = ""
	}
	return []TraceModel{{Model: model, Effort: effort, Source: source}}
}

func mergeTraceModels(left, right []TraceModel) []TraceModel {
	// Copy before appending: cached pages and observations may share slices.
	merged := slices.Clone(left)
	for _, model := range right {
		if !slices.Contains(merged, model) {
			merged = append(merged, model)
		}
	}
	return merged
}

// A fresh wrapper belongs to each forward scan, including every enlarged tail
// window. A context outside that window is unknown, not borrowed from a cache.
func traceParserWithModels(agent string, parse traceParser) traceParser {
	if agent != "codex" && agent != "claude" {
		return parse
	}
	var context []TraceModel
	var taskID string
	used, sawUser := false, false
	return func(line []byte) []parsedEvent {
		events := parse(line)
		var record struct {
			Type    string `json:"type"`
			Payload struct {
				Type   string `json:"type"`
				TurnID string `json:"turn_id"`
				Model  string `json:"model"`
				Effort string `json:"effort"`
			} `json:"payload"`
			Message struct {
				Model string `json:"model"`
			} `json:"message"`
		}
		if json.Unmarshal(line, &record) != nil {
			context, taskID, used, sawUser = nil, "", false, false
			return events
		}
		if agent == "claude" {
			if record.Type == "assistant" {
				for i := range events {
					events[i].Models = traceModel(record.Message.Model, "", "claude_message")
				}
			}
			return events
		}
		p := record.Payload
		if record.Type == "event_msg" {
			switch p.Type {
			case "task_started":
				context, taskID, used, sawUser = nil, p.TurnID, false, false
			case "task_complete", "task_completed", "turn_aborted":
				context, taskID, used, sawUser = nil, "", false, false
			}
		}
		if record.Type == "turn_context" {
			if taskID != "" && p.TurnID != "" && taskID != p.TurnID {
				context = nil
				return events
			}
			context = traceModel(p.Model, p.Effort, "codex_context")
			used = false
		}
		for i := range events {
			ev := &events[i]
			if turnHead(ev.Type) {
				// Older logs without task boundaries need a fresh context after
				// each completed response. A context just before the user is valid.
				if (used || sawUser) && taskID == "" {
					context = nil
				}
				sawUser = true
				continue
			}
			if ev.outputOnly || (ev.Type != "assistant" && ev.Type != "thinking" && ev.Type != "tool") {
				continue
			}
			ev.Models = context
			used = true
		}
		return events
	}
}
