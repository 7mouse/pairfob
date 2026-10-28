package journal

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGeminiSessionEdits(t *testing.T) {
	data := `{"sessionId":"native-session-01","projectHash":"project","kind":"main"}
{"id":"context","type":"user","content":"<session_context>hidden</session_context>"}
{"id":"u1","type":"user","content":"expanded secret","displayContent":[{"text":"Fix session titles"}]}
{"id":"a1","type":"gemini","content":"Checking","toolCalls":[{"id":"call-1","name":"Read","args":{"file_path":"src/main.ts"},"status":"success","result":[{"text":"old result"}]}]}
{"$patch":{"id":"a1","content":"Checked","toolCalls":[{"id":"call-1","result":[{"text":"updated result"}]}]}}
{"id":"u2","type":"user","content":"Abandoned request"}
{"id":"a2","type":"gemini","content":"Abandoned answer"}
{"$rewindTo":"u2"}
{"$set":{"summary":"Session observation"}}
{"id":"incomplete"
`
	// A writer's incomplete final line has no newline yet.
	data = strings.TrimSuffix(data, "\n")
	records, title, err := parseGeminiSession([]byte(data), "native-session-01", true)
	if err != nil || title.Name != "Session observation" || title.Prompt != "Fix session titles" {
		t.Fatalf("title: %+v %v", title, err)
	}
	rendered := string(renderStore(records))
	for _, hidden := range []string{"hidden", "expanded secret", "Abandoned", "old result", "incomplete"} {
		if strings.Contains(rendered, hidden) {
			t.Fatalf("leaked %q: %s", hidden, rendered)
		}
	}
	if !strings.Contains(rendered, "updated result") || !strings.Contains(rendered, "Checked") {
		t.Fatal(rendered)
	}
	if _, _, err := parseGeminiSession([]byte(data), "other-session-01", true); err == nil {
		t.Fatal("accepted wrong metadata id")
	}
	rewound := strings.Split(data, `{"id":"incomplete"`)[0] + "{\"$rewindTo\":\"missing\"}\n"
	records, _, err = parseGeminiSession([]byte(rewound), "native-session-01", true)
	if err != nil || len(records) != 0 {
		t.Fatalf("unknown rewind must clear branch: %+v %v", records, err)
	}
}

func TestGeminiPatchesAndLegacyCheckpoint(t *testing.T) {
	data := `{"sessionId":"native-session-01"}
{"id":"old","type":"user","content":"Old"}
{"$set":{"messages":[{"id":"u1","type":"user","content":"New request"},{"id":"a1","type":"gemini","content":"Answer one"},{"id":"a2","type":"gemini","content":"Answer two"}]}}
{"$patch":{"updates":[{"id":"a2","content":"Updated two"}],"removeIds":["a1"],"orderIds":["a2","u1"]}}
`
	records, title, err := parseGeminiSession([]byte(data), "native-session-01", true)
	if err != nil || len(records) != 2 || records[0].Text != "Updated two" || records[1].Text != "New request" || title.Prompt != "New request" {
		t.Fatalf("records=%+v title=%+v err=%v", records, title, err)
	}
	legacy := `{"sessionId":"native-session-01","messages":[{"id":"u","type":"user","content":[{"text":"Real request"},{"inlineData":{"data":"secret"}}]}]}`
	records, title, err = parseGeminiSession([]byte(legacy), "native-session-01", false)
	if err != nil || len(records) != 1 || title.Prompt != "Real request" {
		t.Fatalf("legacy %+v %+v %v", records, title, err)
	}
}

func TestQwenActiveBranchAndDisplayProjection(t *testing.T) {
	data := `{"uuid":"root","parentUuid":null,"sessionId":"native-session-01","type":"system","subtype":"agent_bootstrap"}
{"uuid":"injected","parentUuid":"root","sessionId":"native-session-01","type":"user","subtype":"agent_message","provenance":"external_agent","message":{"parts":[{"text":"hidden injection"}]}}
{"uuid":"u1","parentUuid":"injected","sessionId":"native-session-01","type":"user","provenance":"real_user","message":{"parts":[{"text":"hidden model expansion"}]},"systemPayload":{"displayText":"Fix session titles","hookContext":"hidden hook"}}
{"uuid":"a1","parentUuid":"u1","sessionId":"native-session-01","type":"assistant","message":{"parts":[{"functionCall":{"id":"call-1","name":"Read","args":{"file_path":"src/main.ts"}}}]}}
{"uuid":"r1","parentUuid":"a1","sessionId":"native-session-01","type":"tool_result","message":{"parts":[{"functionResponse":{"id":"call-1","name":"Read","response":{"output":"file content"}}}]},"toolCallResult":{"callId":"call-1","status":"success"}}
{"uuid":"u2","parentUuid":"r1","sessionId":"native-session-01","type":"user","message":{"parts":[{"text":"Abandoned request"}]}}
{"uuid":"title","parentUuid":"u2","sessionId":"native-session-01","type":"system","subtype":"custom_title","systemPayload":{"customTitle":"Session observation"}}
{"uuid":"rewind","parentUuid":"r1","sessionId":"native-session-01","type":"system","subtype":"rewind","systemPayload":{"truncatedCount":1}}
`
	records, title, err := parseQwenSession([]byte(data), "native-session-01")
	if err != nil || len(records) != 3 || title.Name != "Session observation" || title.Prompt != "Fix session titles" {
		t.Fatalf("%+v %+v %v", records, title, err)
	}
	rendered := string(renderStore(records))
	if strings.Contains(rendered, "hidden") || strings.Contains(rendered, "Abandoned") {
		t.Fatal(rendered)
	}
	for _, bad := range []string{
		strings.Replace(data, `"parentUuid":"r1","sessionId":"native-session-01","type":"system","subtype":"rewind"`, `"parentUuid":"missing","sessionId":"native-session-01","type":"system","subtype":"rewind"`, 1),
		strings.Replace(data, `"sessionId":"native-session-01"`, `"sessionId":"other-session"`, 1),
		data + `{"uuid":"managed","sessionId":"native-session-01","type":"system","subtype":"managed_session_event_v1"}` + "\n",
	} {
		if _, _, err := parseQwenSession([]byte(bad), "native-session-01"); err == nil {
			t.Fatal("accepted malformed/unsupported session")
		}
	}
}

func TestNativeStoreObservation(t *testing.T) {
	for _, agent := range []string{"gemini", "qwen"} {
		t.Run(agent, func(t *testing.T) {
			root := t.TempDir()
			id := "native-session-01"
			r := &Reader{NativeRoots: map[string]string{agent: root}}
			ref := Ref{Source: "herdr:" + agent, Agent: agent, Kind: "id", Value: id}
			path := filepath.Join(root, "tmp", "project", "chats", "session-2026-01-01T00-00-native-s.json")
			content := `{"sessionId":"native-session-01","summary":"Native title","messages":[{"id":"u1","type":"user","content":"Fix session titles"},{"id":"a1","type":"gemini","toolCalls":[{"id":"call-1","name":"Read","args":{"file_path":"src/main.ts"},"status":"success"}]}]}`
			if agent == "qwen" {
				path = filepath.Join(root, "projects", "project", "chats", id+".jsonl")
				content = `{"uuid":"u1","parentUuid":null,"sessionId":"native-session-01","type":"user","systemPayload":{"displayText":"Fix session titles"}}
{"uuid":"a1","parentUuid":"u1","sessionId":"native-session-01","type":"assistant","message":{"parts":[{"functionCall":{"id":"call-1","name":"Read","args":{"file_path":"src/main.ts"}}}]}}
`
			}
			if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
			if !r.Available(ref) {
				t.Fatal("unavailable")
			}
			if title := r.ReadTitle(ref); title.Prompt != "Fix session titles" {
				t.Fatalf("title %+v", title)
			}
			activity, ok := r.ReadTurnActivity(ref, TurnWorking)
			if !ok || activity.Name != "Read" || !strings.Contains(activity.Label, "src/main.ts") {
				t.Fatalf("activity %+v %v", activity, ok)
			}
			page, err := r.Read(ref, nil, 50)
			if err != nil || len(page.Messages) != 2 {
				t.Fatalf("history %+v %v", page, err)
			}
			wire, _ := json.Marshal(page)
			if strings.Contains(string(wire), id) {
				t.Fatal("native identity exposed")
			}
		})
	}
}
