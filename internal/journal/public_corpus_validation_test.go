package journal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Optional, explicit directory of public upstream native captures. The regular
// suite remains offline and uses the small behavior fixtures beside each reader.
func TestPublicNativeCorpus(t *testing.T) {
	root := os.Getenv("PAIRFOB_PUBLIC_AGENT_CORPUS")
	if root == "" {
		t.Skip("set PAIRFOB_PUBLIC_AGENT_CORPUS to the reviewed public capture directory")
	}
	read := func(name string) []byte {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	t.Run("muse", func(t *testing.T) {
		records, title, err := parseMuseSession(read("muse-corpus.jsonl"), "74747474-7474-4747-8747-747474747474")
		if err != nil || title.Prompt == "" {
			t.Fatalf("%+v %v", title, err)
		}
		users, tools, failed := 0, 0, 0
		for _, r := range records {
			if r.Kind == storeUser {
				users++
			}
			if r.Kind == storeTool {
				tools++
			}
			if r.Kind == storeResult && r.State == "error" {
				failed++
			}
		}
		if users != 2 || tools != 3 || failed != 1 {
			t.Fatalf("users=%d tools=%d failed=%d", users, tools, failed)
		}
	})
	t.Run("kimi", func(t *testing.T) {
		base := t.TempDir()
		id := "session_0e9113f5-23d9-4ad4-8a94-a3f44c175d14"
		path := filepath.Join(base, "sessions", "project", id, "agents", "main", "wire.jsonl")
		writeNativeFixture(t, path, string(read("kimi-current.jsonl")))
		writeNativeFixture(t, kimiStatePath(path), string(read("kimi-current-state.json")))
		r := &Reader{NativeRoots: map[string]string{"kimi": base}}
		ref := Ref{Source: "herdr:kimi", Agent: "kimi", Kind: "id", Value: id}
		records, title, err := r.parseKimiSession(read("kimi-current.jsonl"), ref, path, base)
		if err != nil || title.Prompt == "" || len(records) < 5 {
			t.Fatalf("records=%d title=%+v err=%v", len(records), title, err)
		}
		if strings.Contains(string(renderStore(records)), "SANITIZED_NATIVE_KIMI_") {
			t.Fatal("injected context leaked")
		}
	})
	t.Run("kiro", func(t *testing.T) {
		base := t.TempDir()
		id := "sess_d3a5510d-40b8-4a77-be1c-bf31a17f584d"
		path := filepath.Join(base, "sessions", "workspace", id, "messages.jsonl")
		writeNativeFixture(t, path, string(read("kiro-current.jsonl")))
		writeNativeFixture(t, filepath.Join(filepath.Dir(path), "session.json"), string(read("kiro-current-meta.json")))
		r := &Reader{NativeRoots: map[string]string{"kiro": base}}
		ref := Ref{Source: "herdr:kiro", Agent: "kiro", Kind: "id", Value: id}
		records, title, err := r.parseKiroSession(read("kiro-current.jsonl"), ref, path)
		if err != nil || title.Name != "Read README and Run Unit Tests" {
			t.Fatalf("%+v %v", title, err)
		}
		users, tools := 0, 0
		for _, r := range records {
			if r.Kind == storeUser {
				users++
			}
			if r.Kind == storeTool {
				tools++
			}
		}
		if users != 3 || tools != 3 {
			t.Fatalf("users=%d tools=%d", users, tools)
		}
	})
}
