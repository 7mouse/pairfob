package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
	"pairfob/internal/state"
)

type herdrReceipt struct {
	Schema      int          `json:"schema_version"`
	Source      string       `json:"source"`
	Path        string       `json:"install_path"`
	Resolved    string       `json:"resolved_path"`
	Release     herdrRelease `json:"release"`
	InstalledAt string       `json:"installed_at"`
}

type herdrTransaction struct {
	Phase    string        `json:"phase"`
	Next     herdrReceipt  `json:"next"`
	Previous *herdrReceipt `json:"previous,omitempty"`
}

type herdrFiles struct{ dir, target string }

func localHerdrFiles() (herdrFiles, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return herdrFiles{}, err
	}
	dir, err := state.DefaultDir()
	if err != nil {
		return herdrFiles{}, err
	}
	dir, err = filepath.Abs(dir)
	return herdrFiles{dir: dir, target: filepath.Join(home, ".local", "bin", "herdr")}, err
}

func (f herdrFiles) path(name string) string { return filepath.Join(f.dir, "herdr-"+name) }

// The lock lives beside the target, so different Pairfob state directories
// cannot concurrently manage the same dependency.
func (f herdrFiles) lock() (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(f.target), 0755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(f.dir, 0700); err != nil {
		return nil, err
	}
	fd, err := unix.Open(filepath.Join(filepath.Dir(f.target), ".pairfob-herdr.lock"), unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), "herdr install lock")
	st, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	sys, ok := st.Sys().(*syscall.Stat_t)
	if !ok || sys.Uid != uint32(os.Getuid()) || sys.Nlink != 1 || !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 {
		file.Close()
		return nil, errors.New("unsafe Herdr install lock")
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		file.Close()
		return nil, errors.New("another Herdr install or update is running; retry when it finishes")
	}
	return file, nil
}

func writeHerdrJSON(path string, value any) error {
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writeHerdrFile(path, append(b, '\n'), 0600)
}

func writeHerdrFile(path string, payload []byte, mode os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".herdr-state-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if err = f.Chmod(mode); err != nil {
		return err
	}
	if _, err = f.Write(payload); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func readHerdrJSON(path string, value any) error {
	file, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	defer file.Close()
	st, err := file.Stat()
	if err != nil {
		return err
	}
	sys, ok := st.Sys().(*syscall.Stat_t)
	if !ok || sys.Uid != uint32(os.Getuid()) || !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 || st.Size() > 64<<10 {
		return errors.New("unsafe Herdr state file")
	}
	b, err := io.ReadAll(io.LimitReader(file, 64<<10))
	if err != nil {
		return err
	}
	return json.Unmarshal(b, value)
}

func newHerdrReceipt(target string, release herdrRelease) (herdrReceipt, error) {
	resolved, err := canonicalInstallTarget(target)
	return herdrReceipt{Schema: 1, Source: "pairfob", Path: target, Resolved: resolved, Release: release, InstalledAt: time.Now().UTC().Format(time.RFC3339)}, err
}

func (r herdrReceipt) matches(target string) error {
	if r.Schema != 1 || r.Source != "pairfob" || r.Path != target || !stableHerdrRelease.MatchString(r.Release.Version) {
		return errors.New("Herdr installation source is unknown")
	}
	st, err := os.Lstat(target)
	if err != nil {
		return err
	}
	sys, ok := st.Sys().(*syscall.Stat_t)
	if !ok || sys.Uid != uint32(os.Getuid()) || !st.Mode().IsRegular() || st.Mode().Perm()&0022 != 0 || st.Mode().Perm()&0111 == 0 || sys.Nlink != 1 {
		return errors.New("Herdr executable was replaced or has unsafe ownership or permissions")
	}
	resolved, err := filepath.EvalSymlinks(target)
	if err != nil {
		return err
	}
	if resolved != r.Resolved {
		return errors.New("Herdr executable path changed")
	}
	hash, err := executableHash(target)
	if err != nil {
		return err
	}
	if hash != r.Release.SHA256 {
		return errors.New("Herdr executable was changed outside Pairfob; use its original installer to update")
	}
	return nil
}

func (f herdrFiles) receipt() (herdrReceipt, error) {
	var r herdrReceipt
	if err := readHerdrJSON(f.path("install.json"), &r); err != nil {
		return r, fmt.Errorf("Herdr source is unknown; update it using its original installer (Homebrew, mise, Nix or Herdr): %w", err)
	}
	return r, r.matches(f.target)
}

// Installation recovery never infers ownership from a known release hash alone.
// A durable intent and the exact resulting file must both match.
func (f herdrFiles) recoverInstall() error {
	var tx herdrTransaction
	if err := readHerdrJSON(f.path("transaction.json"), &tx); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if tx.Phase != "installing" {
		return nil
	}
	if err := tx.Next.matches(f.target); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return os.Remove(f.path("transaction.json"))
		}
		return fmt.Errorf("unfinished Herdr install conflicts with current file: %w", err)
	}
	if err := writeHerdrJSON(f.path("install.json"), tx.Next); err != nil {
		return err
	}
	return os.Remove(f.path("transaction.json"))
}
