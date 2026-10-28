package journal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNativeLineObservation(t *testing.T) {
	for _, tc := range []struct{ agent, path, content, state string }{
		{"copilot", "session-state/native-session-01/events.jsonl", `
{"type":"session.start","data":{"sessionId":"native-session-01"}}
{"type":"user.message","data":{"content":"hidden skill","source":"skill-pdf"}}
{"type":"user.message","data":{"content":"hidden continuation","isAutopilotContinuation":true}}
{"type":"user.message","agentId":"child","data":{"content":"hidden child"}}
{"type":"user.message","data":{"content":"Fix session titles","transformedContent":"hidden model context"}}
{"type":"tool.execution_start","timestamp":"2026-01-01T00:00:00Z","data":{"toolCallId":"call-1","toolName":"Read","arguments":{"file_path":"src/main.ts"}}}
{"type":"tool.execution_complete","data":{"toolCallId":"call-1","success":false,"error":{"message":"not found"}}}
`, "error"},
		{"kimi", "sessions/project/native-session-01/wire.jsonl", `
{"type":"metadata","protocol_version":"1.0"}
{"timestamp":1767225600,"message":{"type":"TurnBegin","payload":{"user_input":[{"type":"image_url","image_url":{"url":"secret"}},{"type":"text","text":"Fix session titles"}]}}}
{"timestamp":1767225601,"message":{"type":"ToolCall","payload":{"id":"call-1","function":{"name":"Read","arguments":"{\"file_path\":\"src/main.ts\"}"}}}}
{"timestamp":1767225602,"message":{"type":"ToolResult","payload":{"tool_call_id":"call-1","return_value":{"is_error":false,"output":"file contents"}}}}
{"timestamp":1767225603,"message":{"type":"SubagentEvent","payload":{"type":"TurnBegin","user_input":"hidden child"}}}
`, "done"},
	} {
		t.Run(tc.agent, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, filepath.FromSlash(tc.path))
			if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(strings.TrimSpace(tc.content)+"\n"), 0600); err != nil {
				t.Fatal(err)
			}
			r := &Reader{NativeRoots: map[string]string{tc.agent: root}}
			ref := Ref{Source: "herdr:" + tc.agent, Agent: tc.agent, Kind: "id", Value: "native-session-01"}
			if !r.Available(ref) {
				t.Fatal("session unavailable")
			}
			if title := r.ReadTitle(ref); title.Prompt != "Fix session titles" {
				t.Fatalf("title: %+v", title)
			}
			page, err := r.Read(ref, nil, 50)
			if err != nil || len(page.Messages) != 2 || page.Messages[0].Text != "Fix session titles" {
				t.Fatalf("history: %+v %v", page, err)
			}
			activity, ok := r.ReadTurnActivity(ref, TurnDone)
			if !ok || activity.Name != "Read" || activity.State != tc.state || activity.Turn == nil || activity.Turn.Steps != 1 {
				t.Fatalf("activity: %+v %v", activity, ok)
			}
			if !strings.Contains(activity.Label, "src/main.ts") {
				t.Fatalf("label: %q", activity.Label)
			}
			if a := r.ReadActivity(ref); !a.Known || a.Key == "" {
				t.Fatalf("task evidence: %+v", a)
			}
			if tc.agent == "kimi" {
				if err := os.WriteFile(filepath.Join(filepath.Dir(path), "state.json"), []byte(`{"custom_title":"Native name"}`), 0600); err != nil {
					t.Fatal(err)
				}
				r.now = func() time.Time { return time.Now().Add(3 * time.Second) }
				if title := r.ReadTitle(ref); title.Name != "Native name" {
					t.Fatalf("native title: %+v", title)
				}
			}
			for _, bad := range []Ref{
				{Source: "phone", Agent: tc.agent, Kind: "id", Value: ref.Value},
				{Source: ref.Source, Agent: tc.agent, Kind: "id", Value: "another-session"},
				{Source: ref.Source, Agent: tc.agent, Kind: "id", Value: "../../escape"},
			} {
				if r.Available(bad) || r.ReadTitle(bad) != (Title{}) {
					t.Fatalf("accepted wrong binding %+v", bad)
				}
			}
		})
	}
}

func TestNativeLinePathIsolation(t *testing.T) {
	root := t.TempDir()
	r := &Reader{NativeRoots: map[string]string{"kimi": root, "copilot": root}}
	ref := Ref{Source: "herdr:kimi", Agent: "kimi", Kind: "id", Value: "native-session-01"}
	for _, project := range []string{"one", "two"} {
		path := filepath.Join(root, "sessions", project, ref.Value, "wire.jsonl")
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("{}\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if r.Available(ref) {
		t.Fatal("ambiguous session accepted")
	}
	outside := filepath.Join(t.TempDir(), "events.jsonl")
	if err := os.WriteFile(outside, []byte("{}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "session-state", ref.Value)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "events.jsonl")); err != nil {
		t.Fatal(err)
	}
	ref.Agent, ref.Source = "copilot", "herdr:copilot"
	if r.Available(ref) {
		t.Fatal("escaped transcript accepted")
	}
}
