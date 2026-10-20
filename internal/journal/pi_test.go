package journal

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func piLine(value any) []byte { data, _ := json.Marshal(value); return append(data, '\n') }

func piFixture(t *testing.T, lines ...any) (*Reader, Ref, string) {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "sessions", "--work--")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "session.jsonl")
	data := piLine(map[string]any{"type": "session", "version": 3, "id": "session01", "cwd": "/work"})
	for _, line := range lines {
		data = append(data, piLine(line)...)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return &Reader{PiRoot: root}, Ref{Source: "herdr:pi", Agent: "pi", Kind: "path", Value: path}, path
}

func msg(id string, parent any, role string, content any) map[string]any {
	return map[string]any{"type": "message", "id": id, "parentId": parent, "message": map[string]any{"role": role, "content": content}}
}

func TestPiTraceSelectsLatestBranchAndPreservesToolState(t *testing.T) {
	reader, ref, _ := piFixture(t,
		msg("user0001", nil, "user", []any{map[string]any{"type": "text", "text": "question"}, map[string]any{"type": "image", "data": "SECRET_BASE64", "mimeType": "image/png"}}),
		msg("asst0001", "user0001", "assistant", []any{map[string]any{"type": "thinking", "thinking": "reason"}, map[string]any{"type": "toolCall", "id": "call-empty", "name": "Read", "arguments": map[string]any{"path": "empty.txt"}}}),
		map[string]any{"type": "message", "id": "tool0001", "parentId": "asst0001", "message": map[string]any{"role": "toolResult", "toolCallId": "call-empty", "toolName": "Read", "content": []any{}, "isError": false}},
		msg("old00001", "user0001", "assistant", []any{map[string]any{"type": "text", "text": "abandoned secret"}}),
		msg("asst0002", "tool0001", "assistant", []any{map[string]any{"type": "toolCall", "id": "call-error", "name": "Bash", "arguments": map[string]any{"command": "false"}}}),
		map[string]any{"type": "message", "id": "tool0002", "parentId": "asst0002", "message": map[string]any{"role": "toolResult", "toolCallId": "call-error", "toolName": "Bash", "content": []any{map[string]any{"type": "text", "text": "exit 1"}}, "isError": true}},
	)
	page, err := reader.ReadTrace(ref, nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(page)
	if string(encoded) == "" || contains(string(encoded), "abandoned secret") || contains(string(encoded), "SECRET_BASE64") {
		t.Fatalf("leaked abandoned/private data: %s", encoded)
	}
	var tools []Event
	for _, item := range page.Items {
		if item.Type == "tool" {
			tools = append(tools, item)
		}
	}
	if len(tools) != 2 || tools[0].State != "done" || tools[0].Output != "" || tools[1].State != "error" {
		t.Fatalf("unexpected tools: %#v", tools)
	}
	summary, err := reader.ReadTraceSummary(ref, nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range summary.Items {
		if item.Type == "tool" && (item.State == "" || item.DetailRef == "") {
			t.Fatalf("incomplete summary: %#v", item)
		}
	}
	detail, err := reader.ReadTraceDetail(ref, tools[0].DetailRef)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Output != "" || detail.Input != "{\"path\":\"empty.txt\"}" {
		t.Fatalf("empty detail changed: %#v", detail)
	}
}

func TestPiChatDropsAttachmentWrappersAndShowsUserBash(t *testing.T) {
	reader, ref, _ := piFixture(t,
		msg("user0001", nil, "user", []any{
			map[string]any{"type": "image", "data": "SECRET_BASE64", "mimeType": "image/png"},
			map[string]any{"type": "text", "text": "<file name=\"/tmp/notes.txt\">\nsecret notes\n</file>\n<file name=\"/tmp/check.png\"></file>\n检查这个布局"},
		}),
		msg("asst0001", "user0001", "assistant", []any{map[string]any{"type": "text", "text": "ok"}}),
		map[string]any{"type": "message", "id": "bash0001", "parentId": "asst0001", "message": map[string]any{"role": "bashExecution", "command": "git status --short", "output": "M a.go", "exitCode": 0}},
		msg("user0002", "bash0001", "user", "继续"),
		msg("user0003", "user0002", "user", "<skill name=\"lark-calendar\" location=\"/Users/x/.agents/skills/lark-calendar/SKILL.md\">\nReferences are relative to /Users/x/.agents/skills/lark-calendar.\n\n# calendar\n\nsecret skill body\n</skill>"),
		msg("user0004", "user0003", "user", "<skill name=\"vision\" location=\"/Users/x/vision/SKILL.md\">\nReferences are relative to /Users/x/vision.\n\nbody\n</skill>\n\n看看这张图\n\n[Image: original 2481x1245, displayed at 2000x1004. Multiply coordinates by 1.24 to map to original image.]\n[Image: original 800x600, displayed at 800x600. Multiply coordinates by 1.00 to map to original image.]"),
		msg("user0005", "user0004", "user", "只看文字\n\n[Image: original 100x100, displayed at 100x100. Multiply coordinates by 1.00 to map to original image.]"),
		msg("user0006", "user0005", "user", "\n\n[Image: original 100x100, displayed at 100x100. Multiply coordinates by 1.00 to map to original image.]"),
	)
	page, err := reader.ReadTraceWith(ref, nil, 20, TraceOptions{Markers: true})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, item := range page.Items {
		got = append(got, item.Type+":"+item.Text)
	}
	want := []string{
		"user:检查这个布局", "assistant:ok", "command:! git status --short", "user:继续",
		"user:/skill:lark-calendar", "user:/skill:vision 看看这张图", "user:只看文字",
	}
	if len(got) != len(want) {
		t.Fatalf("trace got=%v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("trace got=%v want=%v", got, want)
		}
	}
	// Without markers a user command is still the user's own prompt, and no
	// generated wrapper or instruction body reaches the phone.
	legacy, err := reader.ReadTrace(ref, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range legacy.Items {
		if contains(item.Text, "<file name=") || contains(item.Text, "<skill name=") ||
			contains(item.Text, "[Image: original") || contains(item.Text, "secret skill body") || contains(item.Text, "SECRET_BASE64") {
			t.Fatalf("wrapper or payload leaked: %q", item.Text)
		}
	}
	history, err := reader.Read(ref, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Messages) != 6 || history.Messages[0].Text != "检查这个布局" || history.Messages[0].Role != "user" ||
		history.Messages[3].Text != "/skill:lark-calendar" || history.Messages[4].Text != "/skill:vision 看看这张图" || history.Messages[5].Text != "只看文字" {
		t.Fatalf("history=%#v", history.Messages)
	}
}

func TestPiModelObservationsAndTerminalErrors(t *testing.T) {
	reader, ref, _ := piFixture(t,
		msg("user0001", nil, "user", "go"),
		map[string]any{"type": "message", "id": "asst0001", "parentId": "user0001", "message": map[string]any{
			"role": "assistant", "model": "deepseek-v4.1-flash", "thinkingLevel": "max", "stopReason": "toolUse",
			"content": []any{map[string]any{"type": "text", "text": "working"}, map[string]any{"type": "toolCall", "id": "call-one", "name": "Read", "arguments": map[string]any{"path": "a"}}},
		}},
		// A retried request: the later record supersedes this error.
		map[string]any{"type": "message", "id": "asst0002", "parentId": "asst0001", "message": map[string]any{
			"role": "assistant", "model": "deepseek-v4.1-flash", "thinkingLevel": "max", "stopReason": "error", "errorMessage": "Request timed out.", "content": []any{},
		}},
		map[string]any{"type": "message", "id": "asst0003", "parentId": "asst0002", "message": map[string]any{
			"role": "assistant", "model": "deepseek-v4.1-flash", "thinkingLevel": "low", "stopReason": "stop",
			"content": []any{map[string]any{"type": "text", "text": "done"}},
		}},
		msg("user0002", "asst0003", "user", "again"),
		// A terminal failure: nothing supersedes it before the next prompt.
		map[string]any{"type": "message", "id": "asst0004", "parentId": "user0002", "message": map[string]any{
			"role": "assistant", "model": "claude-sonnet-4", "stopReason": "error", "errorMessage": "Authentication failed", "content": []any{},
		}},
	)
	page, err := reader.ReadTraceWith(ref, nil, 50, TraceOptions{Models: true, Labels: true})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, item := range page.Items {
		models := ""
		for _, model := range item.Models {
			models += "|" + model.Model + "/" + model.Effort + "/" + model.Source
		}
		got = append(got, item.Type+":"+item.Text+item.Name+models)
	}
	want := []string{
		"user:go",
		"assistant:working|deepseek-v4.1-flash/max/pi_message",
		"tool:Read|deepseek-v4.1-flash/max/pi_message",
		"assistant:done|deepseek-v4.1-flash/low/pi_message",
		"user:again",
		"assistant:Authentication failed|claude-sonnet-4//pi_message",
	}
	if len(got) != len(want) {
		t.Fatalf("trace got=%v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("trace got=%v want=%v", got, want)
		}
	}
	// The legacy view stays frozen: no models without the opt-in.
	legacy, err := reader.ReadTrace(ref, nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range legacy.Items {
		if len(item.Models) != 0 {
			t.Fatalf("legacy view leaked models: %#v", item)
		}
	}
}

func TestPiCustomVisibilityPartialAppendAndPagination(t *testing.T) {
	reader, ref, path := piFixture(t,
		map[string]any{"type": "custom_message", "id": "custom01", "parentId": nil, "display": false, "content": "hidden"},
		map[string]any{"type": "custom_message", "id": "custom02", "parentId": "custom01", "display": true, "content": "visible"},
		msg("user0001", "custom02", "user", "one"), msg("asst0001", "user0001", "assistant", []any{map[string]any{"type": "text", "text": "two"}}),
		msg("user0002", "asst0001", "user", "three"), msg("asst0002", "user0002", "assistant", []any{map[string]any{"type": "text", "text": "four"}}),
	)
	file, _ := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	_, _ = file.WriteString(`{"type":"message"`)
	_ = file.Close()
	page, err := reader.Read(ref, nil, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 2 || page.Messages[0].Text != "three" || page.NextCursor == nil {
		t.Fatalf("bad first page: %#v", page)
	}
	older, err := reader.Read(ref, page.NextCursor, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(older.Messages) != 3 || older.Messages[0].Text != "[Extension] visible" {
		t.Fatalf("bad older page: %#v", older)
	}
	for _, item := range older.Messages {
		if contains(item.Text, "hidden") {
			t.Fatalf("hidden custom leaked")
		}
	}
}

func TestPiRejectsEscapesMalformedTreesAndStaleDetails(t *testing.T) {
	reader, ref, path := piFixture(t, msg("user0001", nil, "user", "q"), msg("asst0001", "user0001", "assistant", []any{map[string]any{"type": "toolCall", "id": "call-one", "name": "Read", "arguments": map[string]any{"path": "a"}}}), map[string]any{"type": "message", "id": "tool0001", "parentId": "asst0001", "message": map[string]any{"role": "toolResult", "toolCallId": "call-one", "toolName": "Read", "content": []any{map[string]any{"type": "text", "text": "ok"}}, "isError": false}})
	page, err := reader.ReadTrace(ref, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	detail := page.Items[1].DetailRef
	info, _ := os.Stat(path)
	original, _ := os.ReadFile(path)
	replaced := []byte(stringsReplace(string(original), `"path":"a"`, `"path":"b"`))
	if len(replaced) != len(original) {
		t.Fatal("fixture replacement size changed")
	}
	replacement := path + ".replacement"
	if err := os.WriteFile(replacement, replaced, 0600); err != nil {
		t.Fatal(err)
	}
	_ = os.Chtimes(replacement, info.ModTime(), info.ModTime())
	if err := os.Rename(replacement, path); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.ReadTraceDetail(ref, detail); !errors.Is(err, ErrCursorConflict) {
		t.Fatalf("stale detail err=%v", err)
	}

	outside := filepath.Join(t.TempDir(), "outside.jsonl")
	if err := os.WriteFile(outside, original, 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(reader.PiRoot, "sessions", "escape.jsonl")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if reader.Available(Ref{Source: "herdr:pi", Agent: "pi", Kind: "path", Value: link}) {
		t.Fatal("accepted escaping symlink")
	}
	bad, badRef, _ := piFixture(t, msg("child001", "missing1", "user", "bad"))
	if _, err := bad.ReadTrace(badRef, nil, 20); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("missing parent err=%v", err)
	}
}

func TestPiPaginationProgressesAcrossNonMessagesAndOneEntryBlocks(t *testing.T) {
	blocks := []any{
		map[string]any{"type": "text", "text": "a"}, map[string]any{"type": "thinking", "thinking": "b"},
		map[string]any{"type": "toolCall", "id": "call:colon", "name": "Read", "arguments": map[string]any{"path": "x"}},
		map[string]any{"type": "text", "text": "c"},
	}
	reader, ref, _ := piFixture(t,
		msg("user0001", nil, "user", "first"),
		map[string]any{"type": "model_change", "id": "config01", "parentId": "user0001", "provider": "x", "modelId": "y"},
		msg("asst0001", "config01", "assistant", blocks),
		map[string]any{"type": "message", "id": "tool0001", "parentId": "asst0001", "message": map[string]any{"role": "toolResult", "toolCallId": "call:colon", "toolName": "Read", "content": []any{map[string]any{"type": "text", "text": "result"}}, "isError": false}},
		msg("user0002", "tool0001", "user", "last"),
	)
	var got []string
	var cursor *string
	for pages := 0; pages < 10; pages++ {
		page, err := reader.ReadTrace(ref, cursor, 1)
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range page.Items {
			got = append(got, item.Type+":"+item.Text+item.Name)
		}
		cursor = page.NextCursor
		if cursor == nil {
			break
		}
	}
	want := []string{"user:last", "assistant:a", "thinking:b", "tool:Read", "assistant:c", "user:first"}
	if len(got) != len(want) {
		t.Fatalf("pagination got=%v", got)
	}
	seen := map[string]bool{}
	for _, item := range got {
		if seen[item] {
			t.Fatalf("duplicate page item %q", item)
		}
		seen[item] = true
	}
}

func TestPiTracePaginationSplitsLargeSingleAssistantEntry(t *testing.T) {
	const tools = 8
	blocks := make([]any, 0, tools)
	for index := 0; index < tools; index++ {
		blocks = append(blocks, map[string]any{"type": "toolCall", "id": fmt.Sprintf("call:%d", index), "name": "Read", "arguments": map[string]any{"marker": fmt.Sprintf("input-%d", index), "padding": strings.Repeat("i", 20_000)}})
	}
	lines := []any{msg("user0001", nil, "user", "question"), msg("asst0001", "user0001", "assistant", blocks)}
	parent := "asst0001"
	for index := 0; index < tools; index++ {
		id := fmt.Sprintf("result%03d", index)
		lines = append(lines, map[string]any{"type": "message", "id": id, "parentId": parent, "message": map[string]any{"role": "toolResult", "toolCallId": fmt.Sprintf("call:%d", index), "toolName": "Read", "content": []any{map[string]any{"type": "text", "text": fmt.Sprintf("output-%d:", index) + strings.Repeat("o", 20_000)}}, "isError": false}})
		parent = id
	}
	reader, ref, _ := piFixture(t, lines...)
	for _, limit := range []int{1, 200} {
		seen := map[string]bool{}
		var cursor *string
		for pages := 0; pages < tools+2; pages++ {
			page, err := reader.ReadTrace(ref, cursor, limit)
			if err != nil {
				t.Fatalf("limit %d: %v", limit, err)
			}
			for _, item := range page.Items {
				if item.Type != "tool" {
					continue
				}
				marker := item.Input[:strings.Index(item.Input, ",")]
				if seen[marker] {
					t.Fatalf("limit %d duplicate %q", limit, marker)
				}
				seen[marker] = true
				detail, err := reader.ReadTraceDetail(ref, item.DetailRef)
				if err != nil || !strings.Contains(detail.Output, "output-") {
					t.Fatalf("limit %d detail=%#v err=%v", limit, detail, err)
				}
			}
			cursor = page.NextCursor
			if cursor == nil {
				break
			}
		}
		if len(seen) != tools {
			t.Fatalf("limit %d visited %d/%d tools", limit, len(seen), tools)
		}
	}
}

func TestPiDetailOutputRevisionChangesWithoutInvalidatingOldLocator(t *testing.T) {
	reader, ref, path := piFixture(t, msg("user0001", nil, "user", "q"), msg("asst0001", "user0001", "assistant", []any{map[string]any{"type": "toolCall", "id": "call-one", "name": "Read", "arguments": map[string]any{"path": "a"}}}))
	before, err := reader.ReadTrace(ref, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	oldRef := before.Items[1].DetailRef
	result := map[string]any{"type": "message", "id": "tool0001", "parentId": "asst0001", "message": map[string]any{"role": "toolResult", "toolCallId": "call-one", "toolName": "Read", "content": []any{map[string]any{"type": "text", "text": "landed"}}, "isError": false}}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write(piLine(result))
	_ = file.Close()
	detail, err := reader.ReadTraceDetail(ref, oldRef)
	if err != nil || detail.Output != "landed" {
		t.Fatalf("old locator after result=%#v err=%v", detail, err)
	}
	after, err := reader.ReadTrace(ref, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	if after.Items[1].DetailRef == oldRef {
		t.Fatal("output revision did not change detail ref")
	}
}

func TestPiDetailSurvivesAppendButNotReplacementOrBranchRemoval(t *testing.T) {
	toolCall := msg("asst0001", "user0001", "assistant", []any{map[string]any{"type": "toolCall", "id": "call:1", "name": "Read", "arguments": map[string]any{"path": "a"}}})
	result := map[string]any{"type": "message", "id": "tool0001", "parentId": "asst0001", "message": map[string]any{"role": "toolResult", "toolCallId": "call:1", "toolName": "Read", "content": []any{map[string]any{"type": "text", "text": "ok"}}, "isError": false}}
	reader, ref, path := piFixture(t, msg("user0001", nil, "user", "q"), toolCall, result)
	page, err := reader.ReadTrace(ref, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	detail := page.Items[1].DetailRef
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write(piLine(msg("asst0002", "tool0001", "assistant", []any{map[string]any{"type": "text", "text": "later"}})))
	_ = file.Close()
	if got, err := reader.ReadTraceDetail(ref, detail); err != nil || got.Output != "ok" {
		t.Fatalf("detail after append=%#v err=%v", got, err)
	}
	file, err = os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write(piLine(msg("branch01", "user0001", "assistant", []any{map[string]any{"type": "text", "text": "new branch"}})))
	_ = file.Close()
	if _, err := reader.ReadTraceDetail(ref, detail); !errors.Is(err, ErrCursorConflict) {
		t.Fatalf("abandoned detail err=%v", err)
	}
	data, _ := os.ReadFile(path)
	changed := strings.Replace(string(data), `"path":"a"`, `"path":"b"`, 1)
	if err := os.WriteFile(path, []byte(changed), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.ReadTraceDetail(ref, detail); !errors.Is(err, ErrCursorConflict) {
		t.Fatalf("replacement detail err=%v", err)
	}
}

func TestPiCacheEvictionClearsPointerBearingTail(t *testing.T) {
	entries := make([]piCacheEntry, 3, 4)
	for index := range entries {
		entries[index].session = &piSession{id: fmt.Sprintf("session-%d", index)}
	}
	entries = removePiCacheEntry(entries, 1)
	if len(entries) != 2 {
		t.Fatalf("len=%d", len(entries))
	}
	backing := entries[:cap(entries)]
	for index := len(entries); index < len(backing); index++ {
		if backing[index].session != nil {
			t.Fatalf("retained evicted session at backing index %d", index)
		}
	}
}

func TestPiManySmallRecordsExceedStructuralCacheBudget(t *testing.T) {
	const count = 33_000
	lines := make([]any, 0, count)
	lines = append(lines, msg("user0001", nil, "user", "old question"))
	var parent any = "user0001"
	for index := 1; index < count-2; index++ {
		id := fmt.Sprintf("small%08d", index)
		lines = append(lines, map[string]any{"type": "custom", "id": id, "parentId": parent, "customType": "x", "data": 0})
		parent = id
	}
	lines = append(lines, msg("asst0001", parent, "assistant", []any{map[string]any{"type": "toolCall", "id": "large-call", "name": "Read", "arguments": map[string]any{"path": "large"}}}))
	lines = append(lines, map[string]any{"type": "message", "id": "tool0001", "parentId": "asst0001", "message": map[string]any{"role": "toolResult", "toolCallId": "large-call", "toolName": "Read", "content": []any{map[string]any{"type": "text", "text": "ok"}}, "isError": false}})
	reader, ref, _ := piFixture(t, lines...)
	first, err := reader.ReadTrace(ref, nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 1 || first.NextCursor == nil || first.Items[0].DetailRef == "" {
		t.Fatalf("bad uncached first page: %#v", first)
	}
	reader.piMu.Lock()
	cached := append([]piCacheEntry(nil), reader.piCache...)
	reader.piMu.Unlock()
	if len(cached) != 1 || cached[0].session != nil || cached[0].bytes > maxPiCacheBytes {
		t.Fatalf("oversized parsed tree entered cache: %#v", cached)
	}
	detail, err := reader.ReadTraceDetail(ref, first.Items[0].DetailRef)
	if err != nil || detail.Output != "ok" {
		t.Fatalf("uncached detail=%#v err=%v", detail, err)
	}
	page, err := reader.ReadTrace(ref, first.NextCursor, 1)
	if err != nil || len(page.Items) != 1 || page.Items[0].Text != "old question" {
		t.Fatalf("uncached cursor page=%#v err=%v", page, err)
	}
	if charge := piCacheCharge(1, count); charge <= maxPiCacheBytes {
		t.Fatalf("structural charge undercounted: %d", charge)
	}
}

func TestPiLongLinearTreeUsesSinglePassValidation(t *testing.T) {
	const count = 20_000
	lines := make([]any, 0, count)
	var parent any = nil
	for index := 0; index < count; index++ {
		id := fmt.Sprintf("entry%08d", index)
		lines = append(lines, msg(id, parent, "user", "x"))
		parent = id
	}
	reader, ref, _ := piFixture(t, lines...)
	page, err := reader.ReadTrace(ref, nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Text != "x" {
		t.Fatalf("unexpected long-tree tail: %#v", page)
	}
}

func TestPiRejectsIntermediateSymlink(t *testing.T) {
	root := t.TempDir()
	realDir := filepath.Join(root, "real")
	if err := os.MkdirAll(realDir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(realDir, "s.jsonl")
	if err := os.WriteFile(path, piLine(map[string]any{"type": "session", "version": 3, "id": "session01"}), 0600); err != nil {
		t.Fatal(err)
	}
	sessions := filepath.Join(root, "agent", "sessions")
	if err := os.MkdirAll(sessions, 0700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(sessions, "linked")
	if err := os.Symlink(realDir, link); err != nil {
		t.Fatal(err)
	}
	reader := &Reader{PiRoot: filepath.Join(root, "agent")}
	ref := Ref{Source: "herdr:pi", Agent: "pi", Kind: "path", Value: filepath.Join(link, "s.jsonl")}
	if reader.Available(ref) {
		t.Fatal("accepted intermediate symlink")
	}
}

func TestPiIDLookupRejectsAmbiguityAndUntrustedProvider(t *testing.T) {
	reader, _, path := piFixture(t, msg("user0001", nil, "user", "ok"))
	ref := Ref{Source: "herdr:pi", Agent: "pi", Kind: "id", Value: "session01"}
	if !reader.Available(ref) {
		t.Fatal("id did not resolve")
	}
	copyPath := filepath.Join(filepath.Dir(path), "copy.jsonl")
	data, _ := os.ReadFile(path)
	if err := os.WriteFile(copyPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	reader.now = func() time.Time { return time.Now().Add(codexIndexTTL + time.Second) }
	if _, err := reader.Read(ref, nil, 20); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("ambiguous id err=%v", err)
	}
	if reader.Supports(Ref{Source: "phone", Agent: "pi", Kind: "path", Value: path}) {
		t.Fatal("untrusted source supported")
	}
}

func contains(value, part string) bool { return strings.Contains(value, part) }
func stringsReplace(value, old, replacement string) string {
	return strings.Replace(value, old, replacement, 1)
}
