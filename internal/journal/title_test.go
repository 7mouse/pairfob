package journal

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func titleFixture(t *testing.T) (*Reader, Ref, string) {
	t.Helper()
	r := &Reader{CodexRoot: t.TempDir()}
	ref := Ref{Source: "herdr:codex", Agent: "codex", Kind: "id", Value: "title_session_1234"}
	path := filepath.Join(r.CodexRoot, "sessions", "rollout-"+ref.Value+".jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	return r, ref, path
}

func titleUser(text string) string {
	record := map[string]any{"type": "response_item", "payload": map[string]any{
		"type": "message", "role": "user", "content": []map[string]string{{"type": "input_text", "text": text}},
	}}
	data, _ := json.Marshal(record)
	return string(data) + "\n"
}

func TestTitleFirstRealRequestWithoutInjectedContextOrAttachmentPath(t *testing.T) {
	r, ref, path := titleFixture(t)
	text := titleUser("# AGENTS.md instructions for /repo\n<INSTRUCTIONS>secret setup</INSTRUCTIONS>") +
		titleUser("<environment_context>private environment</environment_context>") +
		titleUser("/Users/test/repo/.pairfob/attachments/abc/attachment.jpg 请修复会话标题\n同时检查列表") + titleUser("继续")
	if err := os.WriteFile(path, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	if got := r.ReadTitle(ref); got.Name != "" || got.Prompt != "请修复会话标题 同时检查列表" {
		t.Fatalf("title=%+v", got)
	}
	// A new daemon derives the same name; a later follow-up never renames it.
	if got := (&Reader{CodexRoot: r.CodexRoot}).ReadTitle(ref); got.Prompt != "请修复会话标题 同时检查列表" {
		t.Fatalf("restart=%+v", got)
	}
}

func TestTitleNativeNameArrivesAfterPromptAndIsScopedToExactSession(t *testing.T) {
	r, ref, _ := titleFixture(t)
	if err := os.WriteFile(filepath.Join(r.CodexRoot, "state_5.sqlite"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(100, 0)
	r.now = func() time.Time { return now }
	name, calls := "", 0
	r.sqlite = func(_ context.Context, db, query string) ([]byte, error) {
		calls++
		if filepath.Base(db) != "state_5.sqlite" || !strings.Contains(query, "where id='"+ref.Value+"'") || strings.Contains(query, "cwd=") {
			t.Fatalf("unsafe title query: %s %s", db, query)
		}
		return json.Marshal([]map[string]string{{"id": ref.Value, "name": name, "prompt": "Fix the mobile session title"}})
	}
	if got := r.ReadTitle(ref); got.Prompt != "Fix the mobile session title" || got.Name != "" {
		t.Fatalf("initial=%+v", got)
	}
	name = "修复会话标题"
	if got := r.ReadTitle(ref); got.Name != "" || calls != 1 {
		t.Fatalf("cache=%+v calls=%d", got, calls)
	}
	now = now.Add(3 * time.Second)
	if got := r.ReadTitle(ref); got.Name != name || calls != 2 {
		t.Fatalf("refresh=%+v calls=%d", got, calls)
	}
	for _, invalid := range []Ref{{Agent: "codex", Kind: "id", Value: ref.Value}, {Source: "herdr:codex", Agent: "codex", Kind: "id", Value: "id' OR 1=1"}, {Source: "herdr:codex", Agent: "codex", Kind: "path", Value: "/private/session"}} {
		if got := r.ReadTitle(invalid); got != (Title{}) || calls != 2 {
			t.Fatalf("untrusted binding read: %+v", got)
		}
	}
}

func TestTitleUnavailableDatabaseFallsBackWithoutReadingAnotherSession(t *testing.T) {
	r, ref, path := titleFixture(t)
	if err := os.WriteFile(path, []byte(titleUser("First request")), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(r.CodexRoot, "state_5.sqlite"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	r.sqlite = func(context.Context, string, string) ([]byte, error) { return nil, errors.New("missing name column") }
	if got := r.ReadTitle(ref); got.Prompt != "First request" {
		t.Fatalf("fallback=%+v", got)
	}
	r.titleCache = nil
	r.sqlite = func(context.Context, string, string) ([]byte, error) {
		return []byte(`[{"id":"another_session","name":"Must not leak","prompt":"Private"}]`), nil
	}
	if got := r.ReadTitle(ref); got.Name != "" || got.Prompt != "First request" {
		t.Fatalf("cross-session=%+v", got)
	}
}

func TestTitleTransientReadFailureKeepsOnlyItsOwnPreviouslyReadName(t *testing.T) {
	r, ref, _ := titleFixture(t)
	if err := os.WriteFile(filepath.Join(r.CodexRoot, "state_5.sqlite"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(100, 0)
	r.now = func() time.Time { return now }
	fail, name := false, "Saved task name"
	r.sqlite = func(context.Context, string, string) ([]byte, error) {
		if fail {
			return nil, errors.New("database is locked")
		}
		return json.Marshal([]map[string]string{{"id": ref.Value, "name": name, "prompt": "First request"}})
	}
	want := r.ReadTitle(ref)
	fail = true
	now = now.Add(3 * time.Second)
	if got := r.ReadTitle(ref); got != want {
		t.Fatalf("temporary failure erased title: %+v", got)
	}
	other := ref
	other.Value = "different_session_1234"
	if got := r.ReadTitle(other); got != (Title{}) {
		t.Fatalf("different binding borrowed title: %+v", got)
	}
	fail, name = false, ""
	now = now.Add(3 * time.Second)
	if got := r.ReadTitle(ref); got.Name != "" || got.Prompt != "First request" {
		t.Fatalf("successful name removal ignored: %+v", got)
	}
	r.CodexRoot = t.TempDir()
	now = now.Add(3 * time.Second)
	if got := r.ReadTitle(ref); got != (Title{}) {
		t.Fatalf("different provider root borrowed title: %+v", got)
	}
}

func TestTitleConfinesFilesAndBoundsExcerpt(t *testing.T) {
	r, ref, path := titleFixture(t)
	outside := filepath.Join(t.TempDir(), "private.jsonl")
	if err := os.WriteFile(outside, []byte(titleUser("Must not leak")), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, path); err != nil {
		t.Fatal(err)
	}
	if got := r.ReadTitle(ref); got != (Title{}) {
		t.Fatalf("symlink=%+v", got)
	}
	got := promptTitle("\u202e" + strings.Repeat("中文", 100))
	if len([]rune(got)) != 72 || strings.Contains(got, "\u202e") || !strings.HasSuffix(got, "…") {
		t.Fatalf("excerpt=%q", got)
	}
}

func TestTitleDropsCodexImageReferenceButKeepsItsRequest(t *testing.T) {
	text := "<image name=[Image #1] path=\"/private/attachment.jpg\">\n</image>\n检查这个布局"
	if got := promptTitle(text); got != "检查这个布局" {
		t.Fatalf("image title=%q", got)
	}
	if got := visibleCodexUserText("Explain this markup:\n" + text); got != "Explain this markup:\n"+text {
		t.Fatal("user's own markup was removed")
	}
}

func TestTitlePiUsesSessionNameAndFirstRequest(t *testing.T) {
	reader, ref, path := piFixture(t,
		msg("user0001", nil, "user", []any{
			map[string]any{"type": "image", "data": "SECRET_BASE64", "mimeType": "image/png"},
			map[string]any{"type": "text", "text": "<file name=\"/tmp/notes.txt\">\nsecret notes\n</file>\n<file name=\"/tmp/check.png\"></file>\n/Users/test/repo/.pairfob/attachments/abc/a.jpg 检查 Pi 会话标题"},
		}),
		msg("asst0001", "user0001", "assistant", []any{map[string]any{"type": "text", "text": "ok"}}),
		msg("user0002", "asst0001", "user", "继续"),
	)
	now := time.Unix(100, 0)
	reader.now = func() time.Time { return now }
	if got := reader.ReadTitle(ref); got.Name != "" || got.Prompt != "检查 Pi 会话标题" {
		t.Fatalf("prompt title=%+v", got)
	}
	// A name set later replaces the excerpt without losing it.
	appendPiRecord(t, path, map[string]any{"type": "session_info", "id": "name0001", "parentId": "user0002", "name": "修复 Pi 标题"})
	now = now.Add(3 * time.Second)
	if got := reader.ReadTitle(ref); got.Name != "修复 Pi 标题" || got.Prompt != "检查 Pi 会话标题" {
		t.Fatalf("stored name=%+v", got)
	}
	// The newest session_info wins, including the explicit clear.
	appendPiRecord(t, path, map[string]any{"type": "session_info", "id": "name0002", "parentId": "name0001", "name": ""})
	now = now.Add(3 * time.Second)
	if got := reader.ReadTitle(ref); got.Name != "" || got.Prompt != "检查 Pi 会话标题" {
		t.Fatalf("cleared name=%+v", got)
	}
}

func TestTitlePiUsesActiveBranchAndStaysInItsProviderRoot(t *testing.T) {
	reader, _, _ := piFixture(t,
		msg("old00001", nil, "user", "Abandoned first request"),
		msg("asst0001", "old00001", "assistant", []any{map[string]any{"type": "text", "text": "old"}}),
		msg("user0002", nil, "user", "Continuing after reset"),
	)
	ref := Ref{Source: "herdr:pi", Agent: "pi", Kind: "id", Value: "session01"}
	if got := reader.ReadTitle(ref); got.Name != "" || got.Prompt != "Continuing after reset" {
		t.Fatalf("active branch=%+v", got)
	}
	if got := (&Reader{PiRoot: t.TempDir()}).ReadTitle(ref); got != (Title{}) {
		t.Fatalf("another provider root borrowed title: %+v", got)
	}
}

func appendPiRecord(t *testing.T, path string, record map[string]any) {
	t.Helper()
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := file.Write(piLine(record)); err != nil {
		t.Fatal(err)
	}
}

func TestLocalTranscriptsCodexTitle(t *testing.T) {
	if os.Getenv("PAIRFOB_SCAN_LOCAL_TRANSCRIPTS") != "1" || os.Getenv("CODEX_THREAD_ID") == "" {
		t.Skip("requires an explicit local scan inside a Codex session")
	}
	r := NewDefault()
	ref := Ref{Source: "herdr:codex", Agent: "codex", Kind: "id", Value: os.Getenv("CODEX_THREAD_ID")}
	got := r.ReadTitle(ref)
	if got == (Title{}) {
		t.Fatal("current Codex session has neither native name nor a readable request")
	}
	if strings.Contains(got.Prompt, ".pairfob/attachments/") || strings.HasPrefix(got.Prompt, "<") || strings.HasPrefix(got.Prompt, "# AGENTS.md") {
		t.Fatal("title contains attachment or injected context")
	}
	t.Logf("current session: native name present=%t, prompt excerpt length=%d", got.Name != "", len([]rune(got.Prompt)))
}

func TestLocalTranscriptsPiTitle(t *testing.T) {
	if os.Getenv("PAIRFOB_SCAN_LOCAL_TRANSCRIPTS") != "1" || os.Getenv("PI_SESSION_FILE") == "" {
		t.Skip("requires an explicit local scan inside a Pi session")
	}
	r := NewDefault()
	ref := Ref{Source: "herdr:pi", Agent: "pi", Kind: "path", Value: os.Getenv("PI_SESSION_FILE")}
	got := r.ReadTitle(ref)
	if got.Prompt == "" {
		t.Fatal("current Pi session has no readable request")
	}
	if strings.Contains(got.Prompt, ".pairfob/attachments/") || strings.HasPrefix(got.Prompt, "<") || strings.HasPrefix(got.Prompt, "# AGENTS.md") {
		t.Fatal("title contains attachment or injected context")
	}
	t.Logf("current session: native name present=%t, prompt excerpt length=%d", got.Name != "", len([]rune(got.Prompt)))
}
