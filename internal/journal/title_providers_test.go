package journal

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCursorTitleAndActivityUseTheSameBoundSession(t *testing.T) {
	r := &Reader{CursorRoot: t.TempDir()}
	writeLines(t, cursorTestPath(r.CursorRoot, "repo"), cursorTurn()...)
	ref := cursorTestRef()
	if got := r.ReadTitle(ref); got.Prompt != "Read note.txt, then list the folder." {
		t.Fatalf("title=%+v", got)
	}
	if got, ok := r.ReadTurnActivity(ref, TurnWorking); !ok || got.Type != "tool" || got.Name != "Glob" {
		t.Fatalf("activity=%+v available=%t", got, ok)
	}
}

func TestGrokTitleChecksMetadataIdentity(t *testing.T) {
	r := &Reader{GrokRoot: t.TempDir()}
	ref := Ref{Source: "herdr:grok", Agent: "grok", Kind: "id", Value: "session_12345678"}
	dir := filepath.Join(r.GrokRoot, "sessions", "repo", ref.Value)
	writeLines(t, filepath.Join(dir, "updates.jsonl"), map[string]any{
		"method": "session/update", "params": map[string]any{"update": map[string]any{
			"sessionUpdate": "user_message_chunk", "content": map[string]string{"type": "text", "text": "Fix title"},
		}},
	})
	for _, id := range []string{"another_session", ref.Value} {
		writeJSONFile(t, filepath.Join(dir, "summary.json"), map[string]any{"info": map[string]string{"id": id}, "generated_title": "Generated title"})
		r.titleCache = nil
		got := r.ReadTitle(ref)
		if got.Prompt != "Fix title" || (got.Name != "") != (id == ref.Value) {
			t.Fatalf("id=%s title=%+v", id, got)
		}
	}
}

func TestOpencodeTitleAndActivityUseSessionMetadataAndTools(t *testing.T) {
	f := newOpencodeFixture(t)
	writeJSONFile(t, filepath.Join(f.root, "storage", "session", "global", opencodeTestID+".json"), map[string]string{"id": opencodeTestID, "title": "Inspect the repo"})
	f.message("msg_001", "user", 1000, nil)
	f.part("msg_001", "prt_001", map[string]any{"type": "text", "text": "Inspect the repo"})
	f.message("msg_002", "assistant", 2000, nil)
	f.tool("msg_002", "prt_002", "bash", "running", map[string]any{"input": map[string]string{"command": "ls"}})
	r := &Reader{OpencodeRoot: f.root}
	if got := r.ReadTitle(opencodeTestRef()); got.Name != "Inspect the repo" {
		t.Fatalf("title=%+v", got)
	}
	if got, ok := r.ReadTurnActivity(opencodeTestRef(), TurnWorking); !ok || got.Name != "bash" || got.State != "running" {
		t.Fatalf("activity=%+v available=%t", got, ok)
	}
}

func TestHermesTitleDoesNotAcceptAnotherSession(t *testing.T) {
	r := &Reader{HermesRoot: t.TempDir()}
	if err := os.WriteFile(filepath.Join(r.HermesRoot, "state.db"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"another_session", hermesTestID} {
		r.titleCache = nil
		r.sqlite = func(_ context.Context, _, sql string) ([]byte, error) {
			if !strings.Contains(sql, "where id='"+hermesTestID+"'") {
				t.Fatal("query lost session binding")
			}
			return json.Marshal([]map[string]string{{"id": id, "title": "Hermes task"}})
		}
		if got := r.ReadTitle(hermesTestRef()); (got.Name != "") != (id == hermesTestID) {
			t.Fatalf("id=%s title=%+v", id, got)
		}
	}
}

func TestStoreTitlesFallBackToFirstVisibleRequest(t *testing.T) {
	f := newOpencodeFixture(t)
	f.message("msg_001", "user", 1000, nil)
	f.part("msg_001", "prt_001", map[string]any{"type": "text", "text": "Injected context", "synthetic": true})
	f.part("msg_001", "prt_002", map[string]any{"type": "text", "text": "First real request"})
	f.message("msg_002", "user", 2000, nil)
	f.part("msg_002", "prt_003", map[string]any{"type": "text", "text": "continue"})
	if got := (&Reader{OpencodeRoot: f.root}).ReadTitle(opencodeTestRef()); got.Prompt != "First real request" {
		t.Fatalf("opencode fallback=%+v", got)
	}
	r := hermesTestReader(t, func() []map[string]any {
		return []map[string]any{hermesRowFixture(1, "user", map[string]any{"content": "First Hermes request"})}
	})
	readMessages := r.sqlite
	r.sqlite = func(ctx context.Context, db, sql string) ([]byte, error) {
		if strings.HasPrefix(sql, "select id,") {
			return json.Marshal([]map[string]string{{"id": hermesTestID, "title": ""}})
		}
		return readMessages(ctx, db, sql)
	}
	if got := r.ReadTitle(hermesTestRef()); got.Prompt != "First Hermes request" {
		t.Fatalf("hermes fallback=%+v", got)
	}
}

func TestLocalTranscriptsProviderTitles(t *testing.T) {
	if os.Getenv("PAIRFOB_SCAN_LOCAL_TRANSCRIPTS") != "1" {
		t.Skip("requires an explicit local transcript scan")
	}
	r := NewDefault()
	ids := map[string][]string{
		"hermes": localHermesSessions(t, r), "opencode": localOpencodeSessions(r),
	}
	for _, provider := range []struct{ agent, pattern string }{
		{"grok", filepath.Join(r.GrokRoot, "sessions", "*", "*", "updates.jsonl")},
		{"cursor", filepath.Join(r.CursorRoot, "projects", "*", "agent-transcripts", "*", "*.jsonl")},
	} {
		files, _ := filepath.Glob(provider.pattern)
		for _, file := range files {
			ids[provider.agent] = append(ids[provider.agent], filepath.Base(filepath.Dir(file)))
		}
	}
	for agent, sessions := range ids {
		names, prompts := 0, 0
		for _, id := range sessions {
			title := r.ReadTitle(Ref{Source: "herdr:" + agent, Agent: agent, Kind: "id", Value: id})
			if title.Name != "" {
				names++
			}
			if title.Prompt != "" {
				prompts++
			}
			if injectedLooking.MatchString(title.Prompt) || strings.Contains(title.Prompt, ".pairfob/attachments/") {
				t.Errorf("%s: title contains injected context or an attachment path", agent)
			}
		}
		t.Logf("%s: %d sessions, %d native names, %d request excerpts", agent, len(sessions), names, prompts)
	}
}
