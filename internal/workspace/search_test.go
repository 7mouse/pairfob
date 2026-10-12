package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func searchFixture(t *testing.T, root string, files ...string) {
	t.Helper()
	for _, name := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func searchPaths(page SearchPage) []string {
	paths := make([]string, 0, len(page.Items))
	for _, item := range page.Items {
		paths = append(paths, item.Path)
	}
	return paths
}

func TestSearchRanksNamesBeforeFoldersAndHonoursGitIgnore(t *testing.T) {
	root := gitFixture(t)
	searchFixture(t, root,
		"src/app.ts", "src/app/routes.ts", "src/features/workspace/files.tsx", "docs/application.md",
		"node_modules/app/index.js", "build/app.js", ".gitignore", "notes/App.vue")
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("node_modules/\nbuild/\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitTestRun(t, root, "add", "src/app.ts")

	page, err := NewInspector().Search(root, "APP", 0)
	if err != nil {
		t.Fatal(err)
	}
	// A name that starts with the word, then one that contains it, then a folder; shorter first; ignored files never.
	want := []string{"src/app.ts", "notes/App.vue", "docs/application.md", "src/app/routes.ts"}
	if got := searchPaths(page); strings.Join(got, ",") != strings.Join(want, ",") || page.Truncated {
		t.Fatalf("got %v truncated=%v", got, page.Truncated)
	}
	if page.Items[0].Name != "app.ts" || page.Query != "APP" {
		t.Fatalf("page=%+v", page)
	}

	exact, err := NewInspector().Search(root, "files.tsx", 0)
	if err != nil || len(exact.Items) != 1 || exact.Items[0].Path != "src/features/workspace/files.tsx" {
		t.Fatalf("exact=%+v err=%v", exact, err)
	}
	// Every word has to be in the path, in any order.
	words, err := NewInspector().Search(root, "routes src", 0)
	if err != nil || strings.Join(searchPaths(words), ",") != "src/app/routes.ts" {
		t.Fatalf("words=%+v err=%v", words, err)
	}
}

func TestSearchSkipsDeletedFilesAndNeverLeavesTheTree(t *testing.T) {
	root := gitFixture(t)
	if err := os.Remove(filepath.Join(root, "tracked.txt")); err != nil {
		t.Fatal(err)
	}
	page, err := NewInspector().Search(root, "txt", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(searchPaths(page), ","); got != "staged.txt" {
		t.Fatalf("got %s", got)
	}
	for _, query := range []string{"", "   "} {
		empty, err := NewInspector().Search(root, query, 0)
		if err != nil || len(empty.Items) != 0 || empty.Items == nil {
			t.Fatalf("query %q: %+v err=%v", query, empty, err)
		}
	}
	if _, err := NewInspector().Search(root, strings.Repeat("a", MaxSearchQueryRunes+1), 0); !errors.Is(err, ErrInvalidPath) {
		t.Fatalf("long query err=%v", err)
	}
	if _, err := NewInspector().Search(filepath.Join(root, "missing"), "a", 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing root err=%v", err)
	}
	git, err := NewInspector().Search(root, "config", 0)
	if err != nil || len(git.Items) != 0 {
		t.Fatalf(".git must never be searched: %+v err=%v", git, err)
	}
}

func TestSearchIsCappedAndSaysSo(t *testing.T) {
	root := gitFixture(t)
	names := make([]string, 0, MaxSearchLimit+10)
	for index := 0; index < MaxSearchLimit+10; index++ {
		names = append(names, "many/item-"+strconv.Itoa(index)+".txt")
	}
	searchFixture(t, root, names...)
	page, err := NewInspector().Search(root, "item", 1000)
	if err != nil || len(page.Items) != MaxSearchLimit || !page.Truncated {
		t.Fatalf("items=%d truncated=%v err=%v", len(page.Items), page.Truncated, err)
	}
	few, err := NewInspector().Search(root, "item", 3)
	if err != nil || len(few.Items) != 3 || !few.Truncated {
		t.Fatalf("few=%+v err=%v", few, err)
	}
}

func TestSearchWalksADirectoryThatIsNotARepository(t *testing.T) {
	root := t.TempDir()
	searchFixture(t, root, "a/readme.md", "b/README.txt", "node_modules/readme/index.js", ".git/readme")
	page, err := NewInspector().Search(root, "readme", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(searchPaths(page), ","); got != "a/readme.md,b/README.txt" {
		t.Fatalf("got %s", got)
	}
}

func TestSearchNamesAFileInConflictOnce(t *testing.T) {
	root := conflictFixture(t)
	page, err := NewInspector().Search(root, "tracked", 0)
	if err != nil || strings.Join(searchPaths(page), ",") != "tracked.txt" {
		t.Fatalf("page=%+v err=%v", page, err)
	}
}

// Items are files to open. A link is not one, whether Git tracks it or not,
// and wherever it points.
func TestSearchListsNoLinks(t *testing.T) {
	outside := t.TempDir()
	searchFixture(t, outside, "secret-notes.txt")
	for _, repository := range []bool{true, false} {
		root := t.TempDir()
		if repository {
			root = gitFixture(t)
		}
		searchFixture(t, root, "real-notes.txt")
		if err := os.Symlink(filepath.Join(outside, "secret-notes.txt"), filepath.Join(root, "link-notes.txt")); err != nil {
			t.Skipf("no symlinks here: %v", err)
		}
		if err := os.Symlink(outside, filepath.Join(root, "notes-dir")); err != nil {
			t.Fatal(err)
		}
		if repository {
			gitTestRun(t, root, "add", "link-notes.txt", "notes-dir")
		}
		page, err := NewInspector().Search(root, "notes", 0)
		if err != nil || strings.Join(searchPaths(page), ",") != "real-notes.txt" {
			t.Fatalf("repository=%v page=%+v err=%v", repository, page, err)
		}
	}
}

// The listing is kept for a moment between the searches of one stretch of
// typing. A file deleted meanwhile is still left out, and another workspace
// never reads this one's listing.
func TestSearchReusesAListingOnlyForItsOwnWorkspace(t *testing.T) {
	first, second := gitFixture(t), gitFixture(t)
	searchFixture(t, first, "only-in-first.txt")
	if page, err := NewInspector().Search(first, "only", 0); err != nil || len(page.Items) != 1 {
		t.Fatalf("page=%+v err=%v", page, err)
	}
	if err := os.Remove(filepath.Join(first, "only-in-first.txt")); err != nil {
		t.Fatal(err)
	}
	if page, err := NewInspector().Search(first, "only", 0); err != nil || len(page.Items) != 0 {
		t.Fatalf("a deleted file was listed: %+v err=%v", page, err)
	}
	if page, err := NewInspector().Search(second, "only", 0); err != nil || len(page.Items) != 0 {
		t.Fatalf("another workspace read this listing: %+v err=%v", page, err)
	}
}

// A file renamed from here is found by its new name at once: the listing kept
// between searches is not older than the rename.
func TestSearchSeesANameGivenByARenameJustMade(t *testing.T) {
	root := gitFixture(t)
	canonical, err := canonicalRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	searchFixture(t, root, "draft-notes.txt")
	if page, err := NewInspector().Search(root, "draft", 0); err != nil || len(page.Items) != 1 {
		t.Fatalf("page=%+v err=%v", page, err)
	}
	info, err := os.Stat(filepath.Join(root, "draft-notes.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if err := MutateFile(root, canonical, "draft-notes.txt", "final-notes.txt", FileRevision(info), info.Size(), info.ModTime().UnixMilli(), true); err != nil {
		t.Fatal(err)
	}
	if page, err := NewInspector().Search(root, "final", 0); err != nil || strings.Join(searchPaths(page), ",") != "final-notes.txt" {
		t.Fatalf("the new name was not found: %+v err=%v", page, err)
	}
	if page, err := NewInspector().Search(root, "draft", 0); err != nil || len(page.Items) != 0 {
		t.Fatalf("the old name is still listed: %+v err=%v", page, err)
	}
}
