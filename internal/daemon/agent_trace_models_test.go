package daemon

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"pairfob/internal/journal"
	"pairfob/internal/runtime"
)

func TestAgentTraceModelSummaryIsAnAuthorizedReadExtension(t *testing.T) {
	root := t.TempDir()
	id := "session_models_12345678"
	path := filepath.Join(root, "sessions", "2026", "10", "12", "rollout-"+id+".jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	lines := `{"type":"turn_context","payload":{"model":"gpt-5","effort":"high"}}
{"type":"response_item","payload":{"type":"function_call","name":"Read","call_id":"c1","arguments":"{\"path\":\"private\"}"}}
{"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"secret body"}}
`
	if err := os.WriteFile(path, []byte(lines), 0600); err != nil {
		t.Fatal(err)
	}
	fake := runtime.NewFake()
	fake.Snap.Panes[0].Agent = "codex"
	fake.Snap.Panes[0].AgentSession = &runtime.AgentSessionRef{Source: "herdr:codex", Agent: "codex", Kind: "id", Value: id}
	engine, client := runtimeRPCClient(t, fake)
	engine.Journal = &journal.Reader{CodexRoot: root}
	params := map[string]any{"pane_id": "w0:p1", "limit": 20}
	legacy, err := client.RPC("AgentTraceSummary", params)
	if err != nil {
		t.Fatal(err)
	}
	extended, err := client.RPC("AgentTraceModelSummary", params)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(legacy), `"models"`) || !strings.Contains(string(extended), `"effort":"high"`) {
		t.Fatalf("extension shapes: %s / %s", legacy, extended)
	}
	if strings.Contains(string(extended), "private") || strings.Contains(string(extended), "secret body") {
		t.Fatal("model read leaked tool bodies")
	}
	oldItem := decodeResult(t, legacy)["items"].([]any)[0].(map[string]any)
	newItem := decodeResult(t, extended)["items"].([]any)[0].(map[string]any)
	if oldItem["detail_ref"] != newItem["detail_ref"] {
		t.Fatal("detail reference changed")
	}
	for _, op := range []string{"AgentTraceSummary", "AgentTraceModelSummary"} {
		if _, err := client.RPC(op, map[string]any{"pane_id": "missing"}); err == nil || err.Error() != "pane_not_found" {
			t.Fatalf("%s missing pane: %v", op, err)
		}
		if _, err := client.RPC(op, map[string]any{"pane_id": "w0:p1", "models": true}); err == nil || err.Error() != "invalid_argument" {
			t.Fatalf("%s accepted invented parameter: %v", op, err)
		}
	}
}
