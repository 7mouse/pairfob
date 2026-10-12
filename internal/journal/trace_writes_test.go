package journal

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestToolWritesNamesTheFilesAnEditToolWrote(t *testing.T) {
	long := "/repo/" + strings.Repeat("a", maxTraceWriteRunes)
	var many strings.Builder
	many.WriteString("*** Begin Patch\n")
	for index := 0; index < maxTraceWrites+4; index++ {
		many.WriteString("*** Add File: gen/" + string(rune('a'+index)) + ".go\n+x\n")
	}
	for _, tc := range []struct {
		name, tool, input, want string
	}{
		{"claude edit", "Edit", `{"file_path":"/repo/src/app.ts","old_string":"a","new_string":"b"}`, "/repo/src/app.ts"},
		{"claude write", "Write", `{"file_path":"/repo/README.md","content":"x"}`, "/repo/README.md"},
		{"claude multi edit", "MultiEdit", `{"file_path":"/repo/a.go","edits":[{"old_string":"a","new_string":"b"}]}`, "/repo/a.go"},
		{"claude notebook", "NotebookEdit", `{"notebook_path":"/repo/a.ipynb","new_source":"x"}`, "/repo/a.ipynb"},
		{"pi edit", "edit", `{"path":"pwa/src/main.ts","edits":[{"oldText":"a","newText":"b"}]}`, "pwa/src/main.ts"},
		{"opencode write", "write", `{"filePath":"/repo/x.ts","content":"x"}`, "/repo/x.ts"},
		{"hermes write_file", "write_file", `{"path":"notes.md","content":"x"}`, "notes.md"},
		{"cursor search_replace", "search_replace", `{"file_path":"src/a.ts","old_string":"a","new_string":"b"}`, "src/a.ts"},
		{"cursor edit_file", "edit_file", `{"target_file":"src/b.ts","code_edit":"x"}`, "src/b.ts"},
		{"cursor delete", "delete_file", `{"target_file":"src/old.ts"}`, "src/old.ts"},
		{"codex raw patch", "apply_patch", "*** Begin Patch\n*** Update File: a.go\n@@\n-a\n+b\n*** Add File: b.go\n+x\n*** Delete File: c.go\n*** End Patch", "a.go|b.go|c.go"},
		{"patch names a move by both ends", "apply_patch", "*** Begin Patch\n*** Update File: old/name.go\n*** Move to: new/name.go\n*** End Patch", "old/name.go|new/name.go"},
		{"json patch", "apply_patch", `{"input":"*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch"}`, "a.txt"},
		{"a file patched twice is named once", "apply_patch", "*** Update File: a.go\n*** Update File: a.go\n", "a.go"},
		{"editor tool creating", "str_replace_editor", `{"command":"create","path":"/repo/new.py","file_text":"x"}`, "/repo/new.py"},
		{"editor tool viewing writes nothing", "str_replace_editor", `{"command":"view","path":"/repo/new.py"}`, ""},
		// A marker indented by the patch is a line of the file, e.g. a doc that quotes a patch.
		{"patch markers inside a file's text", "apply_patch", "*** Begin Patch\n*** Update File: docs/patches.md\n@@\n *** Update File: quoted.go\n+*** Add File: also-quoted.go\n*** End Patch", "docs/patches.md"},
		// A stored input cut inside its content still names its file; one cut inside the name names none.
		{"input cut after the path", "write", `{"filePath":"/repo/big.ts","content":"` + strings.Repeat("x", 64) + "…", "/repo/big.ts"},
		{"input cut inside the path", "write", `{"content":"x","filePath":"/repo/bi…`, ""},
		{"input cut before any key", "write", `{"fileP…`, ""},
		// Reads, searches and shells name files they do not write, or none at all.
		{"read", "Read", `{"file_path":"/repo/src/app.ts"}`, ""},
		{"grep", "Grep", `{"pattern":"x","path":"src"}`, ""},
		{"shell", "Bash", `{"command":"echo x > /repo/out.txt"}`, ""},
		{"list", "list_dir", `{"target_directory":"/repo"}`, ""},
		{"edit without a path", "Edit", `{"old_string":"a","new_string":"b"}`, ""},
		{"edit with a non-string path", "Edit", `{"file_path":7}`, ""},
		{"empty input", "Write", ``, ""},
		// A path a client cannot use is left out rather than cut or cleaned into another file's name.
		{"control characters", "Write", `{"file_path":"/repo/a\u0007b.ts"}`, ""},
		{"line break", "Write", `{"file_path":"/repo/a\nb.ts"}`, ""},
		{"too long", "Write", `{"file_path":"` + long + `"}`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := strings.Join(toolWrites(tc.tool, tc.input), "|"); got != tc.want {
				t.Fatalf("toolWrites(%s)=%q, want %q", tc.tool, got, tc.want)
			}
		})
	}
	if got := toolWrites("apply_patch", many.String()); len(got) != maxTraceWrites || got[0] != "gen/a.go" {
		t.Fatalf("a large patch is capped at %d files: %d %v", maxTraceWrites, len(got), got)
	}
}

func TestTraceSummaryWritesAreOptIn(t *testing.T) {
	root := t.TempDir()
	id := "session_12345678"
	writeLines(t, filepath.Join(root, "sessions", "2026", "10", "03", "rollout-"+id+".jsonl"),
		map[string]any{"type": "response_item", "payload": map[string]any{
			"type": "message", "role": "user", "content": []map[string]any{{"type": "input_text", "text": "fix it"}},
		}},
		map[string]any{"type": "response_item", "payload": map[string]any{
			"type": "function_call", "name": "exec_command", "call_id": "call_1", "arguments": `{"cmd":"go test ./..."}`,
		}},
		map[string]any{"type": "response_item", "payload": map[string]any{
			"type": "function_call_output", "call_id": "call_1", "output": "Process exited with code 0\nOutput:\nok",
		}},
		map[string]any{"type": "response_item", "payload": map[string]any{
			"type": "custom_tool_call", "name": "apply_patch", "call_id": "call_2", "input": "*** Begin Patch\n*** Update File: a.go\n*** Add File: b.go\n*** End Patch",
		}},
	)
	ref := Ref{Source: "herdr:codex", Agent: "codex", Kind: "id", Value: id}
	reader := &Reader{CodexRoot: root}
	plain, err := reader.ReadTraceSummary(ref, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	if encoded, _ := json.Marshal(plain); strings.Contains(string(encoded), `"writes"`) {
		t.Fatalf("writes without opt-in: %s", encoded)
	}
	labelled, err := reader.ReadTraceSummaryWith(ref, nil, 20, TraceOptions{Labels: true})
	if err != nil {
		t.Fatal(err)
	}
	if encoded, _ := json.Marshal(labelled); strings.Contains(string(encoded), `"writes"`) {
		t.Fatalf("writes with labels alone: %s", encoded)
	}
	written, err := reader.ReadTraceSummaryWith(ref, nil, 20, TraceOptions{Writes: true})
	if err != nil || len(written.Items) != len(plain.Items) {
		t.Fatalf("written=%+v err=%v", written, err)
	}
	var writes []string
	for i, item := range written.Items {
		if item.DetailRef != plain.Items[i].DetailRef {
			t.Fatalf("detail ref changed with writes: %q != %q", item.DetailRef, plain.Items[i].DetailRef)
		}
		if item.Type != "tool" && len(item.Writes) > 0 {
			t.Fatalf("writes on a non-tool item: %+v", item)
		}
		if item.Label != "" {
			t.Fatalf("label without its own opt-in: %+v", item)
		}
		writes = append(writes, strings.Join(item.Writes, ","))
	}
	// The prompt, the shell call (which names no file) and the patch.
	if got := strings.Join(writes, "|"); got != "||a.go,b.go" {
		t.Fatalf("writes=%q", got)
	}
}

func TestPiTraceSummaryWrites(t *testing.T) {
	reader, ref, _ := piFixture(t,
		msg("user0001", nil, "user", []any{map[string]any{"type": "text", "text": "change it"}}),
		msg("asst0001", "user0001", "assistant", []any{
			map[string]any{"type": "toolCall", "id": "call-1", "name": "read", "arguments": map[string]any{"path": "/work/a.go"}},
			map[string]any{"type": "toolCall", "id": "call-2", "name": "edit", "arguments": map[string]any{"path": "/work/a.go", "edits": []any{}}},
			map[string]any{"type": "toolCall", "id": "call-3", "name": "write", "arguments": map[string]any{"path": "/work/b.go", "content": "x"}},
		}),
	)
	page, err := reader.ReadTraceSummaryWith(ref, nil, 20, TraceOptions{Writes: true})
	if err != nil {
		t.Fatal(err)
	}
	var writes []string
	for _, item := range page.Items {
		if item.Type == "tool" {
			writes = append(writes, strings.Join(item.Writes, ","))
		}
	}
	if got := strings.Join(writes, "|"); got != "|/work/a.go|/work/b.go" {
		t.Fatalf("pi writes=%q", got)
	}
}

func TestSummaryWritesAreDroppedBeforeTimesWhenAPageOverflows(t *testing.T) {
	path := strings.Repeat("p", 900)
	items := make([]TraceSummaryItem, 0, 400)
	for index := 0; index < 400; index++ {
		items = append(items, TraceSummaryItem{Type: "tool", Name: "Edit", DetailRef: "r", Writes: []string{path}, At: 1_700_000_000_000})
	}
	fitSummaryExtras(items)
	total, withWrites, withTimes := 0, 0, 0
	for _, item := range items {
		total += summaryItemSize(item)
		if len(item.Writes) > 0 {
			withWrites++
		}
		if item.At != 0 {
			withTimes++
		}
	}
	if total > maxTraceItemsBytes || withWrites == len(items) || withTimes != len(items) {
		t.Fatalf("total=%d writes kept=%d times kept=%d", total, withWrites, withTimes)
	}
	// The newest items keep theirs: the oldest are dropped first.
	if len(items[len(items)-1].Writes) == 0 || len(items[0].Writes) != 0 {
		t.Fatalf("oldest=%v newest=%v", items[0].Writes, items[len(items)-1].Writes)
	}
}
