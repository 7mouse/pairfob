package main

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func TestHerdrUpdateLifecycle(t *testing.T) {
	for _, tc := range []struct {
		name                                               string
		running                                            []string
		restart, confirm, startFails, resumeFails, changes bool
		pending, fail                                      bool
	}{
		{name: "stopped activates"},
		{name: "running stages", running: []string{"default"}, pending: true},
		{name: "declined stages", running: []string{"default"}, restart: true, pending: true},
		{name: "confirmed restarts", running: []string{"default"}, restart: true, confirm: true},
		{name: "named refused", running: []string{"default", "work"}, restart: true, confirm: true, pending: true},
		{name: "startup rollback", startFails: true, fail: true},
		{name: "resume failure", resumeFails: true, fail: true},
		{name: "session appeared", changes: true, fail: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := herdrInstallFixture(t)
			old, p := herdrCandidate("1.0.0")
			if err := installHerdrRelease(f, old, p); err != nil {
				t.Fatal(err)
			}
			receipt, err := f.receipt()
			if err != nil {
				t.Fatal(err)
			}
			next, payload := herdrCandidate("1.1.0")
			running := append([]string(nil), tc.running...)
			stops, pauses, resumes, starts, queries := 0, 0, 0, 0, 0
			a := herdrUpdateActions{
				servers: func() ([]string, error) {
					queries++
					if tc.changes && queries == 2 {
						return []string{"unexpected"}, nil
					}
					return running, nil
				},
				identity: func() (string, error) { return "pid/start", nil },
				confirm:  func(string, string, []string) bool { return tc.confirm },
				pause: func() (func() error, error) {
					pauses++
					return func() error {
						resumes++
						if tc.resumeFails {
							return errors.New("resume failed")
						}
						return nil
					}, nil
				},
				stop: func(id string) error {
					if id != "pid/start" {
						t.Fatal(id)
					}
					stops++
					running = nil
					return nil
				},
				start: func(version string) error {
					starts++
					if tc.startFails && version == "1.1.0" {
						return errors.New("new service failed")
					}
					return nil
				},
				stopCandidate: func() error { return nil },
			}
			err = applyHerdrUpdate(f, receipt, next, payload, tc.restart, a)
			if errors.Is(err, errHerdrPending) != tc.pending || (err != nil) != (tc.pending || tc.fail) {
				t.Fatalf("err=%v", err)
			}
			if tc.pending && (stops != 0 || pauses != 0 || starts != 0) {
				t.Fatalf("pending changed service: %d %d %d", stops, pauses, starts)
			}
			if pauses != resumes {
				t.Fatalf("pause=%d resume=%d", pauses, resumes)
			}
			got, err := f.receipt()
			if err != nil {
				t.Fatal(err)
			}
			want := "1.1.0"
			if tc.pending || tc.startFails || tc.changes {
				want = "1.0.0"
			}
			if got.Release.Version != want {
				t.Fatalf("installed %s want %s", got.Release.Version, want)
			}
			if tc.startFails && starts != 2 {
				t.Fatal("old service not recovered")
			}
		})
	}
}

func TestHerdrInterruptedUpdateRecovery(t *testing.T) {
	for _, when := range []string{"before replacement", "after replacement", "external change"} {
		t.Run(when, func(t *testing.T) {
			f := herdrInstallFixture(t)
			old, p := herdrCandidate("1.0.0")
			if err := installHerdrRelease(f, old, p); err != nil {
				t.Fatal(err)
			}
			receipt, _ := f.receipt()
			next, payload := herdrCandidate("1.1.0")
			nr, _ := newHerdrReceipt(f.target, next)
			if err := writeHerdrJSON(f.path("update.json"), herdrTransaction{Phase: "switching", Next: nr, Previous: &receipt}); err != nil {
				t.Fatal(err)
			}
			if when != "before replacement" {
				if when == "external change" {
					payload = []byte("unknown")
				}
				if err := writeHerdrFile(f.target, payload, 0755); err != nil {
					t.Fatal(err)
				}
			}
			err := f.recoverHerdrUpdate()
			if when == "external change" {
				if err == nil {
					t.Fatal("claimed external change")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			got, err := f.receipt()
			if err != nil {
				t.Fatal(err)
			}
			want := "1.0.0"
			if when == "after replacement" {
				want = "1.1.0"
			}
			if got.Release.Version != want {
				t.Fatal(got)
			}
		})
	}
}

func TestHerdrUpdateExternalReplacementBeforeCommit(t *testing.T) {
	f := herdrInstallFixture(t)
	r, p := herdrCandidate("1.0.0")
	if err := installHerdrRelease(f, r, p); err != nil {
		t.Fatal(err)
	}
	old, _ := f.receipt()
	next, payload := herdrCandidate("1.1.0")
	a := herdrUpdateActions{servers: func() ([]string, error) { return nil, nil }, pause: func() (func() error, error) {
		_ = os.WriteFile(f.target, []byte("external"), 0755)
		return func() error { return nil }, nil
	}}
	err := applyHerdrUpdate(f, old, next, payload, false, a)
	if err == nil || !strings.Contains(err.Error(), "changed outside") {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(f.target)
	if string(b) != "external" {
		t.Fatal("overwrote external update")
	}
}

func TestHerdrUpdatePreservesInterruptedBackupUntilVerified(t *testing.T) {
	f := herdrInstallFixture(t)
	old, payload := herdrCandidate("1.0.0")
	if err := installHerdrRelease(f, old, payload); err != nil {
		t.Fatal(err)
	}
	previous, _ := f.receipt()
	next, candidate := herdrCandidate("1.1.0")
	r, _ := newHerdrReceipt(f.target, next)
	if err := writeHerdrFile(f.path("backup"), payload, 0700); err != nil {
		t.Fatal(err)
	}
	if err := writeHerdrJSON(f.path("update.json"), herdrTransaction{Phase: "switching", Next: r, Previous: &previous}); err != nil {
		t.Fatal(err)
	}
	if err := writeHerdrFile(f.target, candidate, 0755); err != nil {
		t.Fatal(err)
	}
	if err := f.recoverHerdrUpdate(); err != nil {
		t.Fatal(err)
	}
	if err := f.requireSettledUpdate(); err == nil {
		t.Fatal("allowed another update to overwrite recovery backup")
	}
	if err := f.finishVerifiedUpdate("1.0.0"); err == nil {
		t.Fatal("accepted old running service")
	}
	if _, err := os.Stat(f.path("backup")); err != nil {
		t.Fatal("lost backup", err)
	}
	if err := f.finishVerifiedUpdate("1.1.0"); err != nil {
		t.Fatal(err)
	}
	if err := f.requireSettledUpdate(); err != nil {
		t.Fatal(err)
	}
}

func TestHerdrUpdatePreparationFailureRestartsVerifiedOldServer(t *testing.T) {
	f := herdrInstallFixture(t)
	old, payload := herdrCandidate("1.0.0")
	if err := installHerdrRelease(f, old, payload); err != nil {
		t.Fatal(err)
	}
	previous, _ := f.receipt()
	next, candidate := herdrCandidate("1.1.0")
	// A directory at the backup destination simulates a durable-write failure.
	if err := os.Mkdir(f.path("backup"), 0700); err != nil {
		t.Fatal(err)
	}
	running, starts, resumed := true, 0, false
	err := applyHerdrUpdate(f, previous, next, candidate, true, herdrUpdateActions{
		servers: func() ([]string, error) {
			if running {
				return []string{"default"}, nil
			}
			return nil, nil
		},
		identity: func() (string, error) { return "owned", nil },
		confirm:  func(string, string, []string) bool { return true },
		pause:    func() (func() error, error) { return func() error { resumed = true; return nil }, nil },
		stop:     func(string) error { running = false; return nil },
		start: func(version string) error {
			if version != "1.0.0" {
				t.Fatal(version)
			}
			starts++
			running = true
			return nil
		},
	})
	if err == nil || starts != 1 || !resumed || !running {
		t.Fatalf("error=%v starts=%d resumed=%v running=%v", err, starts, resumed, running)
	}
	if err := previous.matches(f.target); err != nil {
		t.Fatal(err)
	}
}
