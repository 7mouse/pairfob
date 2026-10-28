package journal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClineSessionObservation(t *testing.T) {
	root := t.TempDir()
	id := "native-session-01"
	path := filepath.Join(root, id, id+".messages.json")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	data := `{"version":1,"agent":"lead","sessionId":"native-session-01","system_prompt":"hidden system prompt","messages":[
{"role":"user","metadata":{"kind":"compaction_summary"},"content":"hidden compaction"},
{"role":"user","metadata":{"displayRole":"status"},"content":"hidden status"},
{"role":"user","sessionId":"native-session-01","ts":1767225600000,"content":[{"type":"text","text":"<mode_notice>hidden mode</mode_notice><user_input mode=\"act\">Fix session titles</user_input><file_content>hidden attachment</file_content>"}]},
{"role":"assistant","content":[{"type":"tool_use","id":"call-1","name":"Read","input":{"file_path":"src/main.ts"}}]},
{"role":"user","content":[{"type":"tool_result","tool_use_id":"call-1","is_error":true,"content":"File not found"}]}]}`
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	r := &Reader{NativeRoots: map[string]string{"cline": root}}
	ref := Ref{Source: "herdr:cline", Agent: "cline", Kind: "id", Value: id}
	if title := r.ReadTitle(ref); title.Prompt != "Fix session titles" {
		t.Fatalf("title %+v", title)
	}
	page, err := r.Read(ref, nil, 50)
	if err != nil || len(page.Messages) != 2 {
		t.Fatalf("history %+v %v", page, err)
	}
	activity, ok := r.ReadTurnActivity(ref, TurnDone)
	if !ok || activity.Name != "Read" || activity.State != "error" || !activity.Turn.Failed {
		t.Fatalf("activity %+v %v", activity, ok)
	}
	for _, bad := range []string{
		strings.Replace(data, `"agent":"lead"`, `"agent":"subagent"`, 1),
		strings.Replace(data, `"version":1`, `"version":2`, 1),
		strings.ReplaceAll(data, `"sessionId":"native-session-01"`, `"sessionId":"other-session"`),
	} {
		if _, _, err := parseClineSession([]byte(bad), id); err == nil {
			t.Fatal("accepted incompatible session")
		}
	}
}
