package daemon

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"pairfob/internal/runtime"
)

func TestCreateConversationRejectsMissingOrNonDirectoryBeforeMutation(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PAIRFOB_ALLOWED_ROOTS", root)
	file := filepath.Join(root, "file")
	if err := os.WriteFile(file, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	fake := runtime.NewFake()
	_, client := runtimeRPCClient(t, fake)
	before, err := fake.Observe(context.Background(), runtime.DefaultSession(), runtime.SnapshotQuery{})
	if err != nil {
		t.Fatal(err)
	}
	for i, path := range []string{filepath.Join(root, "missing"), file, filepath.Join(root, "file", "child")} {
		_, err := client.RPC("CreateConversation", map[string]any{"operation_id": []string{"op_missing_dir_0001", "op_regular_file_001", "op_file_child_00001"}[i], "cwd": path})
		if err == nil || err.Error() != "invalid_argument" {
			t.Fatalf("%s: %v", path, err)
		}
	}
	after, err := fake.Observe(context.Background(), runtime.DefaultSession(), runtime.SnapshotQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(before.(runtime.SnapshotView).Snapshot.Workspaces) != len(after.(runtime.SnapshotView).Snapshot.Workspaces) {
		t.Fatal("invalid cwd created a workspace")
	}
}
