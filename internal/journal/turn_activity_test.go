package journal

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func tool(name, label, state string, at int64, writes ...string) TraceSummaryItem {
	return TraceSummaryItem{Type: "tool", Name: name, Label: label, State: state, At: at, Writes: writes}
}

func TestTurnActivityShowsTheLatestStepOfTheCurrentTurn(t *testing.T) {
	items := []TraceSummaryItem{
		{Type: "user", Text: "earlier", At: 1},
		tool("Bash", "old command", "done", 2),
		{Type: "user", Text: "now", At: 10},
		tool("Read", "a.go", "done", 11),
		tool("Bash", "go test ./...", "running", 12),
	}
	got, ok := reduceTurnActivity(items, false, TurnWorking)
	if !ok || got.Type != "tool" || got.Name != "Bash" || got.Label != "go test ./..." || got.State != "running" || got.At != 12 || got.Turn != nil {
		t.Fatalf("got=%+v ok=%v", got, ok)
	}
	for _, kind := range []string{"thinking", "assistant"} {
		got, ok = reduceTurnActivity(append(items, TraceSummaryItem{Type: kind, Text: "secret words", At: 13}), false, TurnWorking)
		if !ok || got.Type != kind || got.Name != "" || got.Label != "" || got.State != "" || got.At != 13 {
			t.Fatalf("%s: got=%+v", kind, got)
		}
	}
	// A turn with nothing after its prompt has no step to show.
	if got, ok := reduceTurnActivity(append(items, TraceSummaryItem{Type: EventCommand, Text: "/clear"}), false, TurnDone); ok {
		t.Fatalf("empty turn: %+v", got)
	}
	// Markers and compaction are no step.
	got, ok = reduceTurnActivity(append(items, TraceSummaryItem{Type: EventCompaction}), false, TurnWorking)
	if !ok || got.Label != "go test ./..." {
		t.Fatalf("compaction: %+v", got)
	}
}

func TestTurnActivityBlockedShowsTheToolItWaitsOn(t *testing.T) {
	items := []TraceSummaryItem{
		{Type: "user"},
		tool("Bash", "git push origin main", "running", 5),
		{Type: "assistant", Text: "waiting", At: 6},
	}
	got, ok := reduceTurnActivity(items, false, TurnBlocked)
	if !ok || got.Name != "Bash" || got.Label != "git push origin main" || got.State != "running" || got.At != 6 {
		t.Fatalf("got=%+v", got)
	}
	// Nothing running: the latest step, as for a working agent.
	items[1].State = "done"
	if got, _ := reduceTurnActivity(items, false, TurnBlocked); got.Type != "assistant" {
		t.Fatalf("no running tool: %+v", got)
	}
}

func TestTurnActivitySummarizesAFinishedTurn(t *testing.T) {
	items := []TraceSummaryItem{
		{Type: "user"},
		tool("Edit", "a.go", "done", 1, "a.go"),
		tool("Write", "b.go", "done", 2, "b.go"),
		tool("Edit", "a.go", "done", 3, "a.go"),
		tool("Edit", "c.go", "error", 4, "c.go"),
		tool("TodoWrite", "2/5", "done", 5),
		tool("update_plan", "3/5", "done", 6),
		tool("Bash", "1/2", "done", 7),
		{Type: "assistant", Text: "done", At: 8},
	}
	got, ok := reduceTurnActivity(items, true, TurnDone)
	want := TurnSummary{Steps: 7, Files: 2, Plan: "3/5"}
	if !ok || got.Turn == nil || *got.Turn != want || got.Type != "assistant" || got.At != 8 {
		t.Fatalf("got=%+v turn=%+v", got, got.Turn)
	}
	// A turn that stopped on a failed step, then was interrupted.
	failed := append(items[:len(items)-1:len(items)-1], tool("Bash", "go vet ./...", "error", 9), TraceSummaryItem{Type: EventInterrupt})
	got, _ = reduceTurnActivity(failed, false, TurnDone)
	if got.Turn == nil || !got.Turn.Failed || !got.Turn.Interrupted || got.Label != "go vet ./..." || got.State != "error" {
		t.Fatalf("failed=%+v turn=%+v", got, got.Turn)
	}
	// A failure the agent talked past is not how the turn ended.
	past := append(append([]TraceSummaryItem(nil), failed[:len(failed)-1]...), TraceSummaryItem{Type: "assistant"})
	if got, _ := reduceTurnActivity(past, false, TurnDone); got.Turn.Failed {
		t.Fatalf("past failure: %+v", got.Turn)
	}
	// Only a finished turn is summarized.
	if got, _ := reduceTurnActivity(items, false, TurnWorking); got.Turn != nil {
		t.Fatalf("working turn summarized: %+v", got.Turn)
	}
}

func TestTurnActivityLeavesOutATurnWhoseHeadIsOutsideTheWindow(t *testing.T) {
	items := []TraceSummaryItem{tool("Edit", "a.go", "done", 1, "a.go"), {Type: "assistant"}}
	got, ok := reduceTurnActivity(items, true, TurnDone)
	if !ok || got.Turn != nil || got.Type != "assistant" {
		t.Fatalf("partial turn: %+v", got)
	}
	// With nothing older the window is the whole transcript.
	if got, _ := reduceTurnActivity(items, false, TurnDone); got.Turn == nil || got.Turn.Files != 1 {
		t.Fatalf("whole transcript: %+v", got)
	}
}

func TestTurnActivityClipsLabelsOnARuneBoundary(t *testing.T) {
	label := strings.Repeat("a", maxActivityLabelBytes-1) + "界面"
	got, _ := reduceTurnActivity([]TraceSummaryItem{tool("Bash", label, "running", 0)}, false, TurnWorking)
	if got.Label != strings.Repeat("a", maxActivityLabelBytes-1) {
		t.Fatalf("label=%q (%d bytes)", got.Label, len(got.Label))
	}
}

func TestTurnActivityReadsClaudeAndCodexTranscripts(t *testing.T) {
	root := t.TempDir()
	id := "12345678-abcd-4321-abcd-1234567890ab"
	writeLines(t, filepath.Join(root, "projects", "-tmp-pairfob", id+".jsonl"),
		map[string]any{"type": "user", "timestamp": "2026-10-16T10:00:00Z", "message": map[string]any{"role": "user", "content": "fix it"}},
		map[string]any{"type": "assistant", "timestamp": "2026-10-16T10:00:05Z", "message": map[string]any{"role": "assistant", "content": []map[string]any{
			{"type": "thinking", "thinking": "hidden chain of thought"},
			{"type": "tool_use", "id": "toolu_1", "name": "Edit", "input": map[string]any{"file_path": "/repo/a.go", "old_string": "secret old", "new_string": "secret new"}},
		}}},
		map[string]any{"type": "user", "timestamp": "2026-10-16T10:00:06Z", "message": map[string]any{"role": "user", "content": []map[string]any{
			{"type": "tool_result", "tool_use_id": "toolu_1", "content": "private file contents"},
		}}},
		map[string]any{"type": "assistant", "timestamp": "2026-10-16T10:00:07Z", "message": map[string]any{"role": "assistant", "content": []map[string]any{
			{"type": "tool_use", "id": "toolu_2", "name": "Bash", "input": map[string]any{"command": "go test ./..."}},
		}}},
	)
	reader := &Reader{ClaudeRoot: root}
	ref := Ref{Source: "herdr:claude", Agent: "claude", Kind: "id", Value: id}
	got, ok := reader.ReadTurnActivity(ref, TurnWorking)
	if !ok || got.Name != "Bash" || got.Label != "go test ./..." || got.State != "running" || got.At != 1792144807000 {
		t.Fatalf("claude working=%+v ok=%v", got, ok)
	}
	got, _ = reader.ReadTurnActivity(ref, TurnDone)
	if got.Turn == nil || got.Turn.Steps != 2 || got.Turn.Files != 1 {
		t.Fatalf("claude done=%+v turn=%+v", got, got.Turn)
	}
	encoded, _ := json.Marshal(got)
	for _, hidden := range []string{"hidden chain", "secret", "private"} {
		if strings.Contains(string(encoded), hidden) {
			t.Fatalf("activity leaked %q: %s", hidden, encoded)
		}
	}

	codexRoot := t.TempDir()
	codexID := "session_12345678"
	writeLines(t, filepath.Join(codexRoot, "sessions", "2026", "10", "16", "rollout-"+codexID+".jsonl"),
		map[string]any{"type": "response_item", "payload": map[string]any{
			"type": "message", "role": "user", "content": []map[string]any{
				{"type": "input_text", "text": "<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>"},
			},
		}},
		map[string]any{"type": "event_msg", "payload": map[string]any{"type": "user_message", "message": "build it"}},
		map[string]any{"type": "response_item", "payload": map[string]any{
			"type": "function_call", "name": "exec_command", "call_id": "call_1", "arguments": `{"cmd":"bun run build"}`,
		}},
		map[string]any{"type": "response_item", "payload": map[string]any{
			"type": "function_call_output", "call_id": "call_1", "output": "Process exited with code 1\nOutput:\nboom",
		}},
	)
	codex := &Reader{CodexRoot: codexRoot}
	got, ok = codex.ReadTurnActivity(Ref{Source: "herdr:codex", Agent: "codex", Kind: "id", Value: codexID}, TurnDone)
	if !ok || got.Name != "exec_command" || got.Label != "bun run build" || got.State != "error" || got.Turn == nil || !got.Turn.Failed || got.Turn.Steps != 1 {
		t.Fatalf("codex=%+v turn=%+v ok=%v", got, got.Turn, ok)
	}
	if _, ok := codex.ReadTurnActivity(Ref{Source: "herdr:codex", Agent: "codex", Kind: "id", Value: "session_missing1"}, TurnWorking); ok {
		t.Fatal("missing transcript produced activity")
	}
}
