package workspace

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func changeAt(t *testing.T, status Status, path string) Change {
	t.Helper()
	for _, change := range status.Changes {
		if change.Path == path {
			return change
		}
	}
	t.Fatalf("no change for %s in %+v", path, status.Changes)
	return Change{}
}

func TestStatusWithStatsCountsEachLayerAndStampsFiles(t *testing.T) {
	root := gitFixture(t)
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// tracked.txt: one line added in the working tree.
	write("tracked.txt", "before\nafter\n")
	// staged.txt: one line replaced in the index, then two more added on disk.
	write("staged.txt", "new\n")
	gitTestRun(t, root, "add", "staged.txt")
	write("staged.txt", "new\nmore\nstill more\n")
	// An untracked text file, an untracked binary and one without a final newline.
	write("fresh.txt", "one\ntwo\nthree\n")
	write("blob.bin", "a\x00b")
	write("tail.txt", "one\ntwo")

	inspector := NewInspector()
	plain, err := inspector.Status(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range plain.Changes {
		if change.Stat != nil || change.ModifiedMS != nil {
			t.Fatalf("a plain status must carry no stats: %+v", change)
		}
	}
	status, err := inspector.StatusWithStats(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Changes) != len(plain.Changes) || status.Revision == plain.Revision || len(status.Revision) != 64 {
		t.Fatalf("status=%+v plain revision=%s", status, plain.Revision)
	}

	tracked := changeAt(t, status, "tracked.txt")
	if tracked.Stat == nil || tracked.Stat.Staged != nil || tracked.Stat.Worktree == nil || *tracked.Stat.Worktree != (LineCount{Additions: 1}) {
		t.Fatalf("tracked=%+v", tracked.Stat)
	}
	staged := changeAt(t, status, "staged.txt")
	if staged.Stat == nil || staged.Stat.Staged == nil || *staged.Stat.Staged != (LineCount{Additions: 1, Deletions: 1}) ||
		staged.Stat.Worktree == nil || *staged.Stat.Worktree != (LineCount{Additions: 2}) {
		t.Fatalf("staged=%+v", staged.Stat)
	}
	if fresh := changeAt(t, status, "fresh.txt"); fresh.Stat == nil || fresh.Stat.Worktree == nil || *fresh.Stat.Worktree != (LineCount{Additions: 3}) {
		t.Fatalf("fresh=%+v", fresh.Stat)
	}
	if blob := changeAt(t, status, "blob.bin"); blob.Stat == nil || blob.Stat.Worktree == nil || !blob.Stat.Worktree.Binary {
		t.Fatalf("blob=%+v", blob.Stat)
	}
	if tail := changeAt(t, status, "tail.txt"); tail.Stat == nil || tail.Stat.Worktree == nil || tail.Stat.Worktree.Additions != 2 {
		t.Fatalf("tail=%+v", tail.Stat)
	}
	now := time.Now().UnixMilli()
	for _, change := range status.Changes {
		if change.ModifiedMS == nil || *change.ModifiedMS > now+1000 || *change.ModifiedMS < now-60_000 {
			t.Fatalf("modified_ms of %s = %v", change.Path, change.ModifiedMS)
		}
	}
}

func TestStatusWithStatsRevisionFollowsAnotherEditOfAModifiedFile(t *testing.T) {
	root := gitFixture(t)
	path := filepath.Join(root, "tracked.txt")
	if err := os.WriteFile(path, []byte("before\nafter\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	inspector := NewInspector()
	first, err := inspector.StatusWithStats(root)
	if err != nil {
		t.Fatal(err)
	}
	plainFirst, _ := inspector.Status(root)
	// The file stays "modified": the plain status does not change, the stats do.
	if err := os.WriteFile(path, []byte("before\nafter\nand again\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	second, err := inspector.StatusWithStats(root)
	if err != nil {
		t.Fatal(err)
	}
	plainSecond, _ := inspector.Status(root)
	if plainFirst.Revision != plainSecond.Revision {
		t.Fatalf("plain status revision changed: %s %s", plainFirst.Revision, plainSecond.Revision)
	}
	if first.Revision == second.Revision || changeAt(t, second, "tracked.txt").Stat.Worktree.Additions != 2 {
		t.Fatalf("first=%s second=%s stat=%+v", first.Revision, second.Revision, changeAt(t, second, "tracked.txt").Stat)
	}
}

func TestParseNumstatReadsRenamesBinariesAndSkipsWhatItCannotTrust(t *testing.T) {
	data := strings.Join([]string{
		"3\t1\tsrc/app.ts",
		"-\t-\tlogo.png",
		"2\t0\t", "old/name.go", "new/name.go",
		"x\t1\tbad-count.txt",
		"1\t1\t../outside.txt",
		"1\t1\t.git/config",
		"only-two\tfields",
		"",
	}, "\x00")
	counts := parseNumstat([]byte(data), false, repositoryState{})
	if len(counts) != 3 || counts["src/app.ts"] != (LineCount{Additions: 3, Deletions: 1}) ||
		!counts["logo.png"].Binary || counts["new/name.go"] != (LineCount{Additions: 2}) {
		t.Fatalf("counts=%+v", counts)
	}
	// A rename cut off before its paths is dropped, not read as something else.
	if got := parseNumstat([]byte("2\t0\t\x00old.go"), false, repositoryState{}); len(got) != 0 {
		t.Fatalf("truncated rename: %+v", got)
	}
	// Output cut at the byte limit ends in half a path, which names another file.
	cut := parseNumstat([]byte("1\t0\tsrc/app.ts\x002\t2\tsrc/ap"), true, repositoryState{})
	if len(cut) != 1 || cut["src/app.ts"] != (LineCount{Additions: 1}) {
		t.Fatalf("cut output: %+v", cut)
	}
	// From a folder of the repository, counts are keyed the way its status is.
	inside := parseNumstat([]byte("1\t0\tsub/a.go\x004\t0\tother/b.go\x00"), false, repositoryState{prefix: "sub/"})
	if len(inside) != 1 || inside["a.go"] != (LineCount{Additions: 1}) {
		t.Fatalf("workspace in a folder: %+v", inside)
	}
}

func TestUntrackedCountsAreBounded(t *testing.T) {
	root := gitFixture(t)
	for index := 0; index < MaxUntrackedCounted+5; index++ {
		name := filepath.Join(root, fmt.Sprintf("new-%03d.txt", index))
		if err := os.WriteFile(name, []byte("line\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	big := filepath.Join(root, "zz-big.txt")
	if err := os.WriteFile(big, []byte(strings.Repeat("x\n", MaxDiffBytes)), 0o644); err != nil {
		t.Fatal(err)
	}
	status, err := NewInspector().StatusWithStats(root)
	if err != nil {
		t.Fatal(err)
	}
	counted := 0
	for _, change := range status.Changes {
		if change.Stat != nil {
			counted++
		}
		if change.ModifiedMS == nil {
			t.Fatalf("%s has no modification time", change.Path)
		}
	}
	if counted != MaxUntrackedCounted {
		t.Fatalf("counted %d untracked files, want %d", counted, MaxUntrackedCounted)
	}
	if count, ok := untrackedCount(root, "zz-big.txt"); ok {
		t.Fatalf("a file too large to diff must go uncounted: %+v", count)
	}
}

// The counts and times ride on a list that may already fill its share of the
// reply. They must not push it past the envelope: the list would then fail
// whole, where a plain status of the same repository still reads.
func TestStatusWithStatsStaysInsideTheReplyBudget(t *testing.T) {
	root := gitFixture(t)
	folder := filepath.Join(root, strings.Repeat("d", 100))
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < MaxStatusEntries; index++ {
		name := filepath.Join(folder, strings.Repeat("f", 60)+"-"+strconv.Itoa(index)+".txt")
		if err := os.WriteFile(name, []byte("line\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	inspector := NewInspector()
	plain, err := inspector.Status(root)
	if err != nil {
		t.Fatal(err)
	}
	status, err := inspector.StatusWithStats(root)
	if err != nil {
		t.Fatal(err)
	}
	// The plain list is already cut to its share of the reply.
	if !plain.Truncated || len(status.Changes) != len(plain.Changes) || len(status.Changes) < 500 {
		t.Fatalf("the list must not shrink for its counts: %d of %d, truncated=%v", len(status.Changes), len(plain.Changes), plain.Truncated)
	}
	size, timed := 0, 0
	for _, change := range status.Changes {
		size += encodedJSONSize(change)
		if change.ModifiedMS != nil {
			timed++
		}
	}
	if size > MaxResultJSONBytes {
		t.Fatalf("changes encode to %d bytes, over the %d a reply may carry", size, MaxResultJSONBytes)
	}
	if status.Changes[0].ModifiedMS == nil || timed == 0 || timed == len(status.Changes) {
		t.Fatalf("%d of %d changes carry a time; the first ones must, the last ones cannot", timed, len(status.Changes))
	}
}

func TestStatusWithStatsLeavesOutATimeBeforeTheEpoch(t *testing.T) {
	root := gitFixture(t)
	path := filepath.Join(root, "tracked.txt")
	if err := os.WriteFile(path, []byte("before\nafter\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	old := time.Date(1960, time.January, 1, 0, 0, 0, 0, time.UTC)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Skipf("this filesystem keeps no time before 1970: %v", err)
	}
	if info, err := os.Stat(path); err != nil || info.ModTime().UnixMilli() >= 0 {
		t.Skip("this filesystem keeps no time before 1970")
	}
	status, err := NewInspector().StatusWithStats(root)
	if err != nil {
		t.Fatal(err)
	}
	change := changeAt(t, status, "tracked.txt")
	if change.ModifiedMS != nil || change.Stat == nil || change.Stat.Worktree == nil {
		t.Fatalf("change=%+v", change)
	}
}

// conflictFixture leaves tracked.txt changed on both sides of a merge.
func conflictFixture(t *testing.T) string {
	t.Helper()
	root := gitFixture(t)
	write := func(content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	gitTestRun(t, root, "checkout", "-b", "other")
	write("theirs\n")
	gitTestRun(t, root, "commit", "-am", "theirs")
	gitTestRun(t, root, "checkout", "main")
	write("ours\nand more\n")
	gitTestRun(t, root, "commit", "-am", "ours")
	command := exec.Command("git", "-C", root, "merge", "other")
	command.Env = append(os.Environ(), "LC_ALL=C")
	if output, err := command.CombinedOutput(); err == nil {
		t.Fatalf("the merge was meant to conflict:\n%s", output)
	}
	return root
}

func TestStatusWithStatsCountsAConflictOnceAndOnlyOnDisk(t *testing.T) {
	root := conflictFixture(t)
	status, err := NewInspector().StatusWithStats(root)
	if err != nil {
		t.Fatal(err)
	}
	change := changeAt(t, status, "tracked.txt")
	if change.Index != "U" || change.Worktree != "U" {
		t.Fatalf("change=%+v", change)
	}
	// Git prints "0 0" for the index of an unmerged path: that is no staged layer.
	if change.Stat == nil || change.Stat.Staged != nil || change.Stat.Worktree == nil || change.Stat.Worktree.Additions == 0 {
		t.Fatalf("stat=%+v", change.Stat)
	}
}

// A pane may sit in a folder of its repository. Every path the workspace's
// reads name is then relative to that folder, so a change listed can be opened.
func TestAWorkspaceInAFolderOfItsRepositoryNamesPathsFromThatFolder(t *testing.T) {
	root := gitFixture(t)
	sub := filepath.Join(root, "sub")
	write := func(name, content string) {
		t.Helper()
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("sub/inner.txt", "one\n")
	write("sub/moved.txt", "same\nlines\nkept\n")
	gitTestRun(t, root, "add", "sub")
	gitTestRun(t, root, "commit", "-m", "sub")
	write("sub/inner.txt", "one\ntwo\n")
	write("sub/fresh.txt", "new\n")
	gitTestRun(t, root, "mv", "sub/moved.txt", "sub/renamed.txt")
	// Changes outside the folder are not this workspace's.
	write("tracked.txt", "before\nafter\n")

	inspector := NewInspector()
	status, err := inspector.StatusWithStats(sub)
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Changes) != 3 {
		t.Fatalf("changes=%+v", status.Changes)
	}
	inner := changeAt(t, status, "inner.txt")
	if inner.Stat == nil || inner.Stat.Worktree == nil || *inner.Stat.Worktree != (LineCount{Additions: 1}) || inner.ModifiedMS == nil {
		t.Fatalf("inner=%+v stat=%+v", inner, inner.Stat)
	}
	fresh := changeAt(t, status, "fresh.txt")
	if fresh.Stat == nil || fresh.Stat.Worktree == nil || *fresh.Stat.Worktree != (LineCount{Additions: 1}) || fresh.ModifiedMS == nil {
		t.Fatalf("fresh=%+v stat=%+v", fresh, fresh.Stat)
	}
	renamed := changeAt(t, status, "renamed.txt")
	if renamed.OriginalPath == nil || *renamed.OriginalPath != "moved.txt" || renamed.Stat == nil || renamed.Stat.Staged == nil {
		t.Fatalf("renamed=%+v stat=%+v", renamed, renamed.Stat)
	}
	for _, path := range []string{"inner.txt", "fresh.txt"} {
		diff, err := inspector.Diff(sub, path, "worktree")
		if err != nil || diff.Additions != 1 || diff.Path != path {
			t.Fatalf("%s: diff=%+v err=%v", path, diff, err)
		}
	}
	if view, err := inspector.Read(sub, "inner.txt"); err != nil || view.Content != "one\ntwo\n" {
		t.Fatalf("view=%+v err=%v", view, err)
	}
	page, err := inspector.Search(sub, "inner", 0)
	if err != nil || len(page.Items) != 1 || page.Items[0].Path != "inner.txt" {
		t.Fatalf("page=%+v err=%v", page, err)
	}
}
