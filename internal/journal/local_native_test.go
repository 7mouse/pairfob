package journal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// These opt-in reads exercise the same exact paths as a trusted runtime
// binding. Zero files is missing native acceptance evidence, not a pass for
// that provider. No local transcript content is copied into fixtures.
func TestLocalTranscriptsNativeStores(t *testing.T) {
	if os.Getenv("PAIRFOB_SCAN_LOCAL_TRANSCRIPTS") != "1" {
		t.Skip("set PAIRFOB_SCAN_LOCAL_TRANSCRIPTS=1")
	}
	r := NewDefault()
	sources := []struct {
		agent, root, pattern string
		ancestor             int
	}{
		{"amp", "amp", "threads/*.json", 0},
		{"droid", "droid", "sessions/*/*.jsonl", 0},
		{"maki", "maki", "sessions/*.jsonl", 0},
		{"qwen", "qwen", "projects/*/chats/*.jsonl", 0},
		{"qodercli", "qodercli", "projects/*/transcript/*.jsonl", 0},
		{"cline", "cline", "*/*.messages.json", 1},
		{"agy", "agy", "brain/*/.system_generated/logs/transcript.jsonl", 3},
		{"letta", "letta", "agent-*/*/transcript.jsonl", 1},
		{"muse", "muse", "sessions/*/*/*/*/session.jsonl", 1},
		{"kiro", "kiro", "sessions/*/sess_*/messages.jsonl", 1},
		{"kimi", "kimi-code", "sessions/*/*/agents/main/wire.jsonl", 3},
	}
	for _, source := range sources {
		paths, _ := filepath.Glob(filepath.Join(r.NativeRoots[source.root], source.pattern))
		ids := make([]string, 0, len(paths))
		for _, path := range paths {
			target := path
			for i := 0; i < source.ancestor; i++ {
				target = filepath.Dir(target)
			}
			id := filepath.Base(target)
			if source.ancestor == 0 {
				id = strings.TrimSuffix(id, filepath.Ext(id))
			}
			if source.agent == "letta" && id == "default" {
				id = "default:" + filepath.Base(filepath.Dir(target))
			}
			ids = append(ids, id)
		}
		scanLocalStore(t, r, source.agent, ids)
	}
}
