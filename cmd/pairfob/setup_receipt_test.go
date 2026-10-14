package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func herdrInstallFixture(t *testing.T) herdrFiles {
	t.Helper()
	dir := t.TempDir()
	f := herdrFiles{dir: filepath.Join(dir, "state"), target: filepath.Join(dir, "bin", "herdr")}
	if err := os.MkdirAll(f.dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(f.target), 0700); err != nil {
		t.Fatal(err)
	}
	return f
}

func herdrCandidate(version string) (herdrRelease, []byte) {
	payload := []byte("#!/bin/sh\nprintf 'herdr " + version + "\\n'\n")
	return herdrRelease{Version: version, SHA256: sha256Hex(payload), Platform: "fixture"}, payload
}

func TestHerdrInstallationReceiptAndRecovery(t *testing.T) {
	for _, phase := range []string{"normal", "before publish", "after publish", "conflict"} {
		t.Run(phase, func(t *testing.T) {
			f := herdrInstallFixture(t)
			r, p := herdrCandidate("1.2.3")
			if phase == "normal" {
				if err := installHerdrRelease(f, r, p); err != nil {
					t.Fatal(err)
				}
			} else {
				receipt, err := newHerdrReceipt(f.target, r)
				if err != nil {
					t.Fatal(err)
				}
				if err = writeHerdrJSON(f.path("transaction.json"), herdrTransaction{Phase: "installing", Next: receipt}); err != nil {
					t.Fatal(err)
				}
				if phase != "before publish" {
					if phase == "conflict" {
						p = []byte("external replacement")
					}
					if err = os.WriteFile(f.target, p, 0755); err != nil {
						t.Fatal(err)
					}
				}
				err = f.recoverInstall()
				if phase == "conflict" {
					if err == nil {
						t.Fatal("claimed external file")
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				if phase == "before publish" {
					if _, err = os.Stat(f.path("transaction.json")); !errors.Is(err, os.ErrNotExist) {
						t.Fatal(err)
					}
					return
				}
			}
			receipt, err := f.receipt()
			if err != nil || receipt.Release.Version != "1.2.3" {
				t.Fatal(receipt, err)
			}
			if err = os.WriteFile(f.target, []byte("changed"), 0755); err != nil {
				t.Fatal(err)
			}
			if _, err = f.receipt(); err == nil {
				t.Fatal("accepted external replacement")
			}
		})
	}
}

func TestHerdrInstallRejectsWrongExecutableVersion(t *testing.T) {
	f := herdrInstallFixture(t)
	r, p := herdrCandidate("1.2.3")
	r.Version = "1.2.4"
	if err := installHerdrRelease(f, r, p); err == nil {
		t.Fatal("wrong version installed")
	}
	if _, err := os.Stat(f.target); !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
}

func TestHerdrTargetLockAcrossStateDirectories(t *testing.T) {
	f := herdrInstallFixture(t)
	lock, err := f.lock()
	if err != nil {
		t.Fatal(err)
	}
	g := f
	g.dir = t.TempDir()
	if other, err := g.lock(); err == nil {
		other.Close()
		t.Fatal("parallel install acquired lock")
	}
	lock.Close()
	other, err := g.lock()
	if err != nil {
		t.Fatal(err)
	}
	other.Close()
}

func TestHerdrReceiptDoesNotAdoptSymlinksOrUnknownInstalls(t *testing.T) {
	f := herdrInstallFixture(t)
	r, p := herdrCandidate("1.2.3")
	if err := os.WriteFile(f.target, p, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := f.receipt(); err == nil {
		t.Fatal("adopted unrecorded file")
	}
	receipt, err := newHerdrReceipt(f.target, r)
	if err != nil {
		t.Fatal(err)
	}
	if err = writeHerdrJSON(f.path("install.json"), receipt); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(f.target, f.target+"-external"); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(f.target+"-external", f.target); err != nil {
		t.Fatal(err)
	}
	if _, err = f.receipt(); err == nil {
		t.Fatal("accepted symlink")
	}
}
