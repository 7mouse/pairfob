package journal

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgyNativeObservation(t *testing.T) {
	root := t.TempDir()
	r := &Reader{NativeRoots: map[string]string{"agy": root}}
	ref := Ref{Source: "herdr:agy", Agent: "agy", Kind: "id", Value: "native-session"}
	data := `{"step_index":0,"source":"USER_IMPLICIT","type":"USER_INPUT","content":"hidden"}
{"step_index":1,"source":"USER_EXPLICIT","type":"USER_INPUT","content":"<USER_REQUEST>Fix titles</USER_REQUEST>"}
{"step_index":2,"source":"MODEL","type":"PLANNER_RESPONSE","content":"hidden superseded partial"}
{"step_index":2,"source":"MODEL","type":"PLANNER_RESPONSE","tool_calls":[{"name":"Read","args":{"path":"main.ts"}}]}
`
	writeNativeFixture(t, filepath.Join(root, "brain", ref.Value, ".system_generated", "logs", "transcript.jsonl"), data)
	checkNativeObservation(t, r, ref, "Fix titles", "Read", "running")
}

func TestLettaNativeObservation(t *testing.T) {
	root := t.TempDir()
	r := &Reader{NativeRoots: map[string]string{"letta": root}}
	ref := Ref{Source: "herdr:letta", Agent: "letta", Kind: "id", Value: "conv-native"}
	data := `{"kind":"user","text":"Fix titles","source_line_id":"u1"}
{"kind":"tool_call","name":"Read","argsText":"{\"path\":\"main.ts\"}","source_line_id":"c1"}
{"kind":"tool_call","name":"Read","argsText":"{\"path\":\"main.ts\"}","resultText":"denied","resultOk":false,"source_line_id":"c1"}
`
	writeNativeFixture(t, filepath.Join(root, "agent-native", ref.Value, "transcript.jsonl"), data)
	checkNativeObservation(t, r, ref, "Fix titles", "Read", "error")
	snapshot, _ := r.loadStore(ref, true)
	if strings.Count(string(snapshot.data), `"k":"tool"`) != 1 {
		t.Fatal("repeated reflection line duplicated")
	}
	writeNativeFixture(t, filepath.Join(root, "agent-other", ref.Value, "transcript.jsonl"), data)
	if _, err := r.loadStore(ref, true); err == nil {
		t.Fatal("ambiguous conversation accepted")
	}
	ref.Value = "default:agent-native"
	writeNativeFixture(t, filepath.Join(root, "agent-native", "default", "transcript.jsonl"), data)
	checkNativeObservation(t, r, ref, "Fix titles", "Read", "error")
	ref.Value = "default:agent-../escape"
	if r.Supports(ref) {
		t.Fatal("unsafe default agent accepted")
	}
}

func TestQoderNativeObservation(t *testing.T) {
	root := t.TempDir()
	r := &Reader{NativeRoots: map[string]string{"qodercli": root}}
	ref := Ref{Source: "herdr:qodercli", Agent: "qodercli", Kind: "id", Value: "native-session"}
	data := `{"type":"user","sessionId":"native-session","message":{"role":"user","content":"Fix titles"}}
{"type":"user","isMeta":true,"message":{"role":"user","content":"hidden"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"c1","name":"Read","input":{"path":"main.ts"}}]}}
`
	writeNativeFixture(t, filepath.Join(root, "projects", "project", "transcript", ref.Value+".jsonl"), data)
	checkNativeObservation(t, r, ref, "Fix titles", "Read", "running")
	if _, _, err := parseQoderSession([]byte(data), "other-session"); err == nil {
		t.Fatal("wrong id accepted")
	}
}

func TestKiroNativeObservation(t *testing.T) {
	root := t.TempDir()
	r := &Reader{NativeRoots: map[string]string{"kiro": root}}
	ref := Ref{Source: "herdr:kiro", Agent: "kiro", Kind: "id", Value: "sess_native-session"}
	path := filepath.Join(root, "sessions", "workspace", ref.Value, "messages.jsonl")
	data := `{"payload":{"type":"user","content":"hidden","_meta":{"kiro":{"syntheticUserMessageReason":"steering"}}}}
{"payload":{"type":"user","content":"Fix titles"}}
{"payload":{"type":"assistant","content":"hidden","parentExecutionId":"child"}}
{"payload":{"type":"tool_call","toolCallId":"c1","toolName":"Read","args":{"path":"main.ts"}}}
{"payload":{"type":"tool_result","toolCallId":"c1","content":"missing","success":false}}
`
	writeNativeFixture(t, path, data)
	metaPath := filepath.Join(filepath.Dir(path), "session.json")
	writeNativeFixture(t, metaPath, `{"schemaVersion":"1.0.0","dataModelVersion":1,"id":"sess_native-session","title":"Kiro title"}`)
	checkNativeObservation(t, r, ref, "Fix titles", "Read", "error")
	writeNativeFixture(t, metaPath, `{"schemaVersion":"1.0.0","dataModelVersion":1,"id":"sess_other-session"}`)
	if _, err := r.loadStore(ref, true); err == nil {
		t.Fatal("wrong metadata accepted")
	}
}

func TestMuseNativeObservation(t *testing.T) {
	root := t.TempDir()
	r := &Reader{NativeRoots: map[string]string{"muse": root}}
	ref := Ref{Source: "herdr:muse", Agent: "muse", Kind: "id", Value: "native-session"}
	payloads := []struct {
		kind    string
		payload any
	}{
		{"runtime.user_intent.accepted", map[string]any{"intent_id": "run1", "source_session_id": ref.Value, "surface": "main", "semantic_kind": map[string]any{"kind": "chat"}, "refill_blocks": []any{map[string]any{"kind": "text", "text": "Fix titles"}}, "model_messages": "hidden"}},
		{"runtime.session", map[string]any{"kind": "run", "run_id": "background", "event": map[string]any{"kind": "assistant_message_committed", "text": "hidden"}}},
		{"runtime.session", map[string]any{"kind": "run", "run_id": "run1", "event": map[string]any{"kind": "assistant_tool_calls_committed", "tool_calls": []any{map[string]any{"call_id": "c1", "name": "Read", "args": `{"path":"main.ts"}`}}}}},
		{"tool_batch.effect.terminal", map[string]any{"run_id": "run1", "record": map[string]any{"call_id": "c1", "outcome": map[string]any{"kind": "failed"}}}},
		{"runtime.session", map[string]any{"kind": "run", "run_id": "run1", "event": map[string]any{"kind": "tool_result_batch_committed", "results": []any{map[string]any{"tool_call_id": "c1", "text": "missing"}}}}},
	}
	var data strings.Builder
	for i, p := range payloads {
		b, _ := json.Marshal(map[string]any{"schema_version": 1, "id": string(rune('a' + i)), "stream": map[string]any{"kind": "session", "id": ref.Value}, "sequence": i + 1, "record_type": "event", "recorded_at": 1767225600000000, "payload_type": p.kind, "payload": p.payload})
		data.Write(b)
		data.WriteByte('\n')
	}
	writeNativeFixture(t, filepath.Join(root, "sessions", "2026", "01", "01", ref.Value, "session.jsonl"), data.String())
	checkNativeObservation(t, r, ref, "Fix titles", "Read", "error")
	if _, _, err := parseMuseSession([]byte(data.String()), "other-session"); err == nil {
		t.Fatal("cross-session stream accepted")
	}
	if _, _, err := parseMuseSession([]byte(data.String()+data.String()), ref.Value); err == nil {
		t.Fatal("replayed/out-of-order sequence accepted")
	}
}
