package journal

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func modelContext(model, effort string) string {
	return `{"type":"turn_context","payload":{"model":"` + model + `","effort":"` + effort + `"}}`
}

func modelMessage(role, text string) string {
	kind := "output_text"
	if role == "user" {
		kind = "input_text"
	}
	return `{"type":"response_item","payload":{"type":"message","role":"` + role + `","content":[{"type":"` + kind + `","text":"` + text + `"}]}}`
}

func modelWindow(t *testing.T, agent string, lines ...string) traceWindow {
	t.Helper()
	w, err := parseTraceWindow([]byte(strings.Join(lines, "\n")+"\n"), 0, 50,
		traceParserWithModels(agent, traceParserFor(agent)), TraceOptions{Models: true})
	if err != nil {
		t.Fatal(err)
	}
	return w
}

func TestCodexModelsBelongToTheirTurnAndKeepChanges(t *testing.T) {
	w := modelWindow(t, "codex",
		modelMessage("user", "first"), modelContext("gpt-5", "high"), modelMessage("assistant", "one"),
		modelMessage("user", "second"), modelContext("gpt-5-mini", "low"), modelMessage("assistant", "two"),
		modelContext("gpt-5", "medium"), modelMessage("assistant", "three"),
		modelMessage("user", "unrecorded"), modelMessage("assistant", "four"),
	)
	if len(w.items) != 7 {
		t.Fatalf("items=%d", len(w.items))
	}
	if got := w.items[1].Models; !reflect.DeepEqual(got, traceModel("gpt-5", "high", "codex_context")) {
		t.Fatalf("first=%+v", got)
	}
	if got := w.items[3].Models; len(got) != 1 || got[0].Model != "gpt-5-mini" || w.items[4].Models[0].Effort != "medium" {
		t.Fatalf("changed=%+v", got)
	}
	if len(w.items[6].Models) != 0 {
		t.Fatal("previous turn leaked into missing context")
	}
}

func TestCodexContextBoundariesFailClosed(t *testing.T) {
	for name, lines := range map[string][]string{
		"start":           {modelContext("gpt-5", "high"), `{"type":"event_msg","payload":{"type":"task_started","turn_id":"new"}}`},
		"complete":        {modelContext("gpt-5", "high"), `{"type":"event_msg","payload":{"type":"task_complete"}}`},
		"abort":           {modelContext("gpt-5", "high"), `{"type":"event_msg","payload":{"type":"turn_aborted"}}`},
		"malformed":       {modelContext("gpt-5", "high"), `{bad`},
		"different turn":  {`{"type":"event_msg","payload":{"type":"task_started","turn_id":"new"}}`, `{"type":"turn_context","payload":{"turn_id":"old","model":"gpt-5","effort":"high"}}`},
		"unanswered user": {modelMessage("user", "old"), modelContext("gpt-5", "high"), modelMessage("user", "new")},
		"missing":         {modelMessage("user", "hello")},
		"invalid model":   {modelContext("untrusted model text", "high")},
	} {
		t.Run(name, func(t *testing.T) {
			w := modelWindow(t, "codex", append(lines, modelMessage("assistant", "answer"))...)
			if len(w.items[len(w.items)-1].Models) != 0 {
				t.Fatal("unproven context attached")
			}
		})
	}
	w := modelWindow(t, "codex", modelContext("gpt-5", "high"), modelMessage("user", "hello"), modelMessage("assistant", "answer"))
	if len(w.items[1].Models) != 1 {
		t.Fatal("context before first user lost")
	}
}

func TestClaudeModelIsMessageLocalAndDoesNotInventEffort(t *testing.T) {
	w := modelWindow(t, "claude",
		`{"type":"assistant","message":{"role":"assistant","model":"claude-opus-4-1","content":[{"type":"text","text":"one"}]}}`,
		`{"type":"assistant","isSidechain":true,"message":{"role":"assistant","model":"child-model","content":[{"type":"text","text":"hidden"}]}}`,
		`{"type":"assistant","message":{"role":"assistant","model":"claude-sonnet-4","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"path":"a"}}]}}`,
		`{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"unknown"}]}}`,
	)
	if len(w.items) != 3 || w.items[0].Models[0].Effort != "" || w.items[1].Models[0].Model != "claude-sonnet-4" || len(w.items[2].Models) != 0 {
		t.Fatalf("items=%+v", w.items)
	}
}

func TestModelsPreservePaginationDetailRefsAndCacheIsolation(t *testing.T) {
	root := t.TempDir()
	id := "session_models_12345678"
	path := filepath.Join(root, "sessions", "2026", "10", "12", "rollout-"+id+".jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	lines := []string{modelMessage("user", "first"), modelContext("gpt-5", "high"),
		`{"type":"response_item","payload":{"type":"function_call","name":"Read","call_id":"c1","arguments":"{}"}}`,
		`{"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"ok"}}`,
		modelMessage("assistant", "answer"), modelMessage("user", "next"), modelContext("gpt-5-mini", "low"), modelMessage("assistant", "next answer")}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	r := &Reader{CodexRoot: root}
	ref := Ref{Source: "herdr:codex", Agent: "codex", Kind: "id", Value: id}
	var cursor *string
	for {
		plain, err := r.ReadTraceSummaryWith(ref, cursor, 3, TraceOptions{})
		if err != nil {
			t.Fatal(err)
		}
		models, err := r.ReadTraceSummaryWith(ref, cursor, 3, TraceOptions{Models: true})
		if err != nil {
			t.Fatal(err)
		}
		without := models
		without.Items = append([]TraceSummaryItem(nil), models.Items...)
		for i := range without.Items {
			without.Items[i].Models = nil
		}
		if !reflect.DeepEqual(plain, without) {
			t.Fatalf("shape changed: %+v / %+v", plain, without)
		}
		if models.NextCursor == nil {
			break
		}
		cursor = models.NextCursor
	}
	page, err := r.ReadTraceWith(ref, nil, 50, TraceOptions{Models: true})
	if err != nil {
		t.Fatal(err)
	}
	page.Items[1].Models[0].Model = "caller-mutation"
	again, err := r.ReadTraceWith(ref, nil, 50, TraceOptions{Models: true})
	if err != nil || again.Items[1].Models[0].Model != "gpt-5" {
		t.Fatal("cached model mutated")
	}
	// Raw trace JSON and legacy summary never gain extension fields.
	raw, _ := json.Marshal(again)
	if strings.Contains(string(raw), `"models"`) {
		t.Fatal("raw trace changed")
	}
}

func TestModelExtrasStayInsideBudget(t *testing.T) {
	items := []TraceSummaryItem{{Type: "assistant", Text: strings.Repeat("a", maxTraceItemsBytes-64), Models: traceModel("gpt-5", "high", "codex_context")}}
	fitSummaryExtras(items)
	if summaryItemSize(items[0]) > maxTraceItemsBytes || len(items[0].Models) != 0 {
		t.Fatal("model extras escaped budget")
	}
}
