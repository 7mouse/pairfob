package daemon

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"pairfob/internal/runtime"
)

func TestTurnActivityFollowsTheAgentStatus(t *testing.T) {
	rt := newMonitorTestRuntime()
	engine := NewEngine(nil, nil, rt)
	ref, appendEvent := taskActivityFixture(t, engine)
	pane := runtime.Pane{PaneID: "p1", Agent: "codex", AgentSession: ref}
	observe := func(status string) runtime.Pane {
		t.Helper()
		pane.AgentStatus = status
		rt.setSnapshot(runtime.Snapshot{Panes: []runtime.Pane{pane}})
		phone, err := engine.snapshot(nil)
		if err != nil {
			t.Fatal(err)
		}
		monitor, err := engine.monitorSnapshot(context.Background(), runtime.DefaultSession())
		if err != nil {
			t.Fatal(err)
		}
		if observedActivity(phone.Panes[0].Activity) != observedActivity(monitor.Panes[0].Activity) {
			t.Fatalf("phone=%+v monitor=%+v", phone.Panes[0].Activity, monitor.Panes[0].Activity)
		}
		return phone.Panes[0]
	}
	appendEvent(`{"type":"event_msg","payload":{"type":"task_started"}}`)
	appendEvent(`{"type":"event_msg","payload":{"type":"user_message","message":"build it"}}`)
	appendEvent(`{"type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"bun run build\",\"token\":\"secret\"}"}}`)
	got := observe("working")
	if got.Activity == nil || got.Activity.Type != "tool" || got.Activity.Name != "exec_command" || got.Activity.Label != "bun run build" ||
		got.Activity.State != "running" || got.Activity.Turn != nil {
		t.Fatalf("working=%+v", got.Activity)
	}
	encoded, _ := json.Marshal(got)
	if !strings.Contains(string(encoded), `"activity":{"type":"tool","name":"exec_command","label":"bun run build","state":"running"}`) ||
		strings.Contains(string(encoded), "secret") {
		t.Fatalf("wire=%s", encoded)
	}
	// Blocked keeps its runtime status and shows what it waits on.
	if got := observe("blocked"); got.AgentStatus != "blocked" || got.Activity == nil || got.Activity.State != "running" {
		t.Fatalf("blocked=%+v", got)
	}
	appendEvent(`{"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"Process exited with code 0\nOutput:\nok"}}`)
	appendEvent(`{"type":"event_msg","payload":{"type":"task_complete"}}`)
	got = observe("done")
	if got.AgentStatus != "done" || got.Activity == nil || got.Activity.Turn == nil || got.Activity.Turn.Steps != 1 || got.Activity.State != "done" {
		t.Fatalf("done=%+v", got.Activity)
	}
	for _, status := range []string{"idle", "unknown", "starting"} {
		if got := observe(status); got.Activity != nil {
			t.Fatalf("%s carried activity %+v", status, got.Activity)
		}
	}
	pending := true
	pane.LaunchPending = &pending
	if got := observe("working"); got.AgentStatus != "idle" || got.Activity != nil {
		t.Fatalf("launch pending=%+v", got)
	}
	pane.LaunchPending = nil
	pane.AgentSession = nil
	if got := observe("working"); got.Activity != nil {
		t.Fatalf("unbound=%+v", got.Activity)
	}
	// A runtime that somehow sent activity is never relayed as transcript truth.
	pane.AgentSession = ref
	pane.Agent = ""
	pane.Activity = &runtime.PaneActivity{Type: "tool", Label: "forged"}
	if got := observe("working"); got.Activity != nil {
		t.Fatalf("forged=%+v", got.Activity)
	}
}

func TestActivityChangePokesButARecordTimeAloneDoesNot(t *testing.T) {
	step := func(label string, at int64, turn *runtime.PaneTurn) monitoredPane {
		return monitoredPane{status: "working", pane: runtime.Pane{Activity: &runtime.PaneActivity{Type: "tool", Name: "Bash", Label: label, State: "running", At: at, Turn: turn}}}
	}
	if observedPaneChanged(step("go test", 1, nil), step("go test", 2, nil)) {
		t.Fatal("a newer time alone poked")
	}
	if !observedPaneChanged(step("go test", 1, nil), step("go vet", 1, nil)) {
		t.Fatal("a new step did not poke")
	}
	if observedPaneChanged(step("x", 1, &runtime.PaneTurn{Steps: 2}), step("x", 1, &runtime.PaneTurn{Steps: 2})) {
		t.Fatal("equal outcomes compared by pointer")
	}
	if !observedPaneChanged(step("x", 1, &runtime.PaneTurn{Steps: 2}), step("x", 1, &runtime.PaneTurn{Steps: 3})) {
		t.Fatal("a new outcome did not poke")
	}
	if !observedPaneChanged(monitoredPane{status: "working"}, step("x", 1, nil)) {
		t.Fatal("first activity did not poke")
	}
}

func TestMonitorFollowsAMidTurnAgentOnlyWhileAPhoneIsConnected(t *testing.T) {
	engine := NewEngine(nil, nil, newMonitorTestRuntime())
	every, healthy := 2*time.Second, 10*time.Second
	state := sessionMonitorState{panes: map[string]monitoredPane{
		"p1": {status: "working", pane: runtime.Pane{Activity: &runtime.PaneActivity{Type: "thinking"}}},
		"p2": {status: "idle"},
	}}
	if got := engine.monitorRefreshEvery(&state, every, healthy); got != healthy {
		t.Fatalf("no phone: %v", got)
	}
	engine.mu.Lock()
	engine.sessions[[16]byte{1}] = &sess{state: "established"}
	engine.mu.Unlock()
	if got := engine.monitorRefreshEvery(&state, every, healthy); got != every {
		t.Fatalf("phone and a working agent: %v", got)
	}
	state.panes["p1"] = monitoredPane{status: "done", pane: runtime.Pane{Activity: &runtime.PaneActivity{Type: "assistant"}}}
	if got := engine.monitorRefreshEvery(&state, every, healthy); got != healthy {
		t.Fatalf("nothing mid-turn: %v", got)
	}
}
