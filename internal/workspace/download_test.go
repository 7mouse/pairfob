package workspace

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func largeDownloadFile(t *testing.T, root string, size int64) string {
	t.Helper()
	name := "large.bin"
	path := filepath.Join(root, name)
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(size); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	head := bytes.Repeat([]byte("h"), mediaSniffBytes)
	last := bytes.Repeat([]byte("z"), mediaSniffBytes)
	if _, err := file.WriteAt(head, 0); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if _, err := file.WriteAt(last, size-int64(len(last))); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return name
}

func TestOpenDownloadReadsOnlyTheSniffHead(t *testing.T) {
	root := t.TempDir()
	const size = int64(40 << 20) // above the 32 MiB media preview cap
	name := largeDownloadFile(t, root, size)
	var observed int
	stop := SetMediaReadObserver(func(n int) { observed += n })
	defer stop()

	opened, err := NewInspector().OpenDownloadContext(context.Background(), root, name, MaxDownloadBytes, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer opened.Close()
	if observed > mediaSniffBytes {
		t.Fatalf("Open read %d bytes; want at most %d", observed, mediaSniffBytes)
	}
	info := opened.Info()
	if info.Size != size || info.MaxBytes != MaxDownloadBytes {
		t.Fatalf("info=%+v", info)
	}
	if info.Kind != MediaDownload || info.MIME != "application/octet-stream" {
		t.Fatalf("sniff=%q/%q", info.Kind, info.MIME)
	}
	if len(info.Revision) != 64 || info.Revision == info.SHA256 {
		t.Fatalf("revision=%q sha=%q", info.Revision, info.SHA256)
	}
	head, eof, err := opened.ReadChunk(0, MediaChunkBytes)
	if err != nil || eof || !bytes.Equal(head, bytes.Repeat([]byte("h"), MediaChunkBytes)) {
		t.Fatalf("head eof=%v err=%v", eof, err)
	}
	last, eof, err := opened.ReadChunk(size-MediaChunkBytes, MediaChunkBytes)
	if err != nil || !eof || !bytes.Equal(last, bytes.Repeat([]byte("z"), MediaChunkBytes)) {
		t.Fatalf("last eof=%v err=%v", eof, err)
	}
}

func TestOpenDownloadRejectsOversizeWithoutReading(t *testing.T) {
	root := t.TempDir()
	name := "huge.bin"
	file, err := os.Create(filepath.Join(root, name))
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(MaxDownloadBytes + 1); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	var observed int
	stop := SetMediaReadObserver(func(n int) { observed += n })
	defer stop()
	opened, err := NewInspector().OpenDownloadContext(context.Background(), root, name, MaxDownloadBytes, nil)
	if opened != nil || !errors.Is(err, ErrTooLarge) {
		t.Fatalf("opened=%v err=%v", opened, err)
	}
	if observed != 0 {
		t.Fatalf("oversize Open read %d bytes", observed)
	}
}

func TestDownloadRevisionTracksTheFileIdentity(t *testing.T) {
	root := t.TempDir()
	name := largeDownloadFile(t, root, 1<<20)
	inspector := NewInspector()
	first, err := inspector.OpenDownloadContext(context.Background(), root, name, MaxDownloadBytes, nil)
	if err != nil {
		t.Fatal(err)
	}
	revision := first.Info().Revision
	_ = first.Close()

	// A same-name rewrite with a new mtime must produce a new revision.
	if err := os.WriteFile(filepath.Join(root, name), []byte("changed"), 0o644); err != nil {
		t.Fatal(err)
	}
	second, err := inspector.OpenDownloadContext(context.Background(), root, name, MaxDownloadBytes, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if second.Info().Revision == revision {
		t.Fatal("revision did not change after the file changed")
	}
}

func TestDownloadReadRejectsAFileChangedUnderTheHandle(t *testing.T) {
	root := t.TempDir()
	name := largeDownloadFile(t, root, 1<<20)
	opened, err := NewInspector().OpenDownloadContext(context.Background(), root, name, MaxDownloadBytes, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer opened.Close()
	if err := os.WriteFile(filepath.Join(root, name), []byte("replaced"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := opened.ReadChunk(0, MediaChunkBytes); !errors.Is(err, ErrChanged) {
		t.Fatalf("ReadChunk err=%v want ErrChanged", err)
	}
}

func TestOpenDownloadRejectsSymlinkLeaf(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	target := filepath.Join(outside, "secret.bin")
	if err := os.WriteFile(target, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, "link.bin")); err != nil {
		t.Fatal(err)
	}
	opened, err := NewInspector().OpenDownloadContext(context.Background(), root, "link.bin", MaxDownloadBytes, nil)
	if opened != nil || !errors.Is(err, ErrInvalidPath) {
		t.Fatalf("opened=%v err=%v", opened, err)
	}
}
