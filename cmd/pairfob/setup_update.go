package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"pairfob/internal/admin"
	runtimeapi "pairfob/internal/runtime"
)

var errHerdrPending = errors.New("Herdr update is prepared but not active; run pairfob setup --update-herdr --restart-herdr when tasks can be interrupted")

type herdrUpdateActions struct {
	servers       func() ([]string, error)
	identity      func() (string, error)
	confirm       func(string, string, []string) bool
	pause         func() (func() error, error)
	stop          func(string) error
	start         func(string) error
	stopCandidate func() error
}

func updateHerdrCommand(restart bool) error {
	f, err := localHerdrFiles()
	if err != nil {
		return err
	}
	layout, err := currentServiceLayout()
	if err != nil {
		return err
	}
	return withServiceLock(layout, func() error {
		lock, err := f.lock()
		if err != nil {
			return err
		}
		defer lock.Close()
		if err = f.recoverInstall(); err != nil {
			return err
		}
		if err = f.recoverHerdrUpdate(); err != nil {
			return err
		}
		if err = f.requireSettledUpdate(); err != nil {
			return err
		}
		old, err := f.receipt()
		if err != nil {
			return err
		}
		binary, err := runtimeapi.ResolveHerdrBinary()
		if err != nil {
			return err
		}
		resolved, err := filepath.EvalSymlinks(binary)
		if err != nil {
			return err
		}
		if resolved != old.Resolved {
			return errors.New("configured Herdr differs from the Pairfob installation; use its original installer")
		}
		for _, key := range []string{"HERDR_CONFIG_PATH", "HERDR_CLIENT_SOCKET_PATH", "XDG_CONFIG_HOME", "XDG_STATE_HOME"} {
			if os.Getenv(key) != "" {
				return fmt.Errorf("custom %s is set; maintain Herdr using its original configuration", key)
			}
		}
		if filepath.Clean(runtimeapi.DefaultSocket()) != filepath.Clean(runtimeapi.FallbackSocket()) {
			return errors.New("custom Herdr socket: maintain that service locally")
		}
		if !herdrAutostartEnabled(false) {
			return errors.New("Herdr automatic startup is disabled; maintain the runtime locally")
		}
		release, err := latestHerdrRelease(runtime.GOOS, runtime.GOARCH)
		if err != nil {
			return err
		}
		if compareHerdrVersions(old.Release.Version, release.Version) > 0 {
			return errors.New("installed Herdr is newer than the stable release; refusing to downgrade")
		}
		h := runtimeapi.NewHerdr(runtimeapi.DefaultSocket())
		check := checkHerdrInstallation(h)
		if old.Release.SHA256 == release.SHA256 && check.State == "ready" && strings.TrimPrefix(check.Descriptor.Version, "v") == release.Version {
			fmt.Printf("Herdr %s is already installed and running.\n", release.Version)
			return nil
		}
		payload, err := fetchHerdrArtifact(release.URL)
		if err != nil {
			return err
		}
		return applyHerdrUpdate(f, old, release, payload, restart, herdrUpdateActions{
			servers: h.MaintenanceServers, identity: h.MaintenanceIdentity, confirm: confirmHerdrRestart,
			pause: func() (func() error, error) { return pausePairfobForHerdr(layout) },
			stop: func(identity string) error {
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				return h.StopForMaintenance(ctx, identity)
			},
			start: func(want string) error {
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				defer cancel()
				ready, err := h.EnsureServer(ctx)
				if err != nil {
					return err
				}
				if strings.TrimPrefix(ready.Descriptor.Version, "v") != want || !ready.Descriptor.Supports(runtimeapi.FeatureCreateConversation) {
					return fmt.Errorf("Herdr is running %s, expected compatible %s", ready.Descriptor.Version, want)
				}
				return nil
			},
			stopCandidate: func() error {
				running, err := h.MaintenanceServers()
				if err != nil || len(running) == 0 {
					return err
				}
				if len(running) != 1 || running[0] != "default" {
					return errors.New("unexpected sessions appeared; inspect before restoring Herdr")
				}
				id, err := h.MaintenanceIdentity()
				if err != nil {
					return err
				}
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				return h.StopForMaintenance(ctx, id)
			},
		})
	})
}

func applyHerdrUpdate(f herdrFiles, old herdrReceipt, release herdrRelease, payload []byte, restart bool, a herdrUpdateActions) (result error) {
	if err := validateHerdrCandidate(filepath.Dir(f.target), release, payload); err != nil {
		return err
	}
	if err := old.matches(f.target); err != nil {
		return err
	}
	next, err := newHerdrReceipt(f.target, release)
	if err != nil {
		return err
	}
	tx := herdrTransaction{Phase: "staged", Next: next, Previous: &old}
	if err = writeHerdrFile(f.path("candidate"), payload, 0700); err != nil {
		return err
	}
	if err = writeHerdrJSON(f.path("update.json"), tx); err != nil {
		return err
	}
	running, err := a.servers()
	if err != nil {
		return err
	}
	sort.Strings(running)
	if len(running) > 0 && !restart {
		fmt.Printf("Herdr %s downloaded and verified. Installed: %s; running sessions: %s. No server was stopped.\n", release.Version, old.Release.Version, strings.Join(running, ", "))
		return errHerdrPending
	}
	identity := ""
	if len(running) > 0 {
		if len(running) != 1 || running[0] != "default" {
			return fmt.Errorf("running named sessions (%s) need local maintenance: %w", strings.Join(running, ", "), errHerdrPending)
		}
		identity, err = a.identity()
		if err != nil {
			return fmt.Errorf("%v: %w", err, errHerdrPending)
		}
		if !a.confirm(old.Release.Version, release.Version, running) {
			return errHerdrPending
		}
	}
	resume, err := a.pause()
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, resume()) }()
	current, err := a.servers()
	if err != nil {
		return err
	}
	sort.Strings(current)
	if strings.Join(current, "\n") != strings.Join(running, "\n") {
		return errors.New("Herdr sessions changed during update; retry after checking them")
	}
	if err = old.matches(f.target); err != nil {
		return err
	}
	if identity != "" {
		// If stopping succeeded but preparation failed, recover the old server
		// while its verified executable is still in place.
		defer func() {
			if result == nil || old.matches(f.target) != nil {
				return
			}
			servers, inspectErr := a.servers()
			if inspectErr != nil {
				result = errors.Join(result, inspectErr)
				return
			}
			if len(servers) == 0 {
				result = errors.Join(result, a.start(old.Release.Version))
			}
		}()
		if err = a.stop(identity); err != nil {
			return err
		}
	}
	if current, err = a.servers(); err != nil {
		return err
	} else if len(current) > 0 {
		return errors.New("Herdr is still running; no executable replaced")
	}
	backup, err := os.ReadFile(f.target)
	if err != nil {
		return err
	}
	if sha256Hex(backup) != old.Release.SHA256 {
		return errors.New("Herdr changed before replacement")
	}
	if err = writeHerdrFile(f.path("backup"), backup, 0700); err != nil {
		return err
	}
	tx.Phase = "switching"
	if err = writeHerdrJSON(f.path("update.json"), tx); err != nil {
		return err
	}
	if err = writeHerdrFile(f.target, payload, 0755); err != nil {
		return err
	}
	if err = writeHerdrJSON(f.path("install.json"), next); err != nil {
		return err
	}
	tx.Phase = "installed"
	if err = writeHerdrJSON(f.path("update.json"), tx); err != nil {
		return err
	}
	if err = a.start(release.Version); err != nil {
		if stopErr := a.stopCandidate(); stopErr != nil {
			return fmt.Errorf("new Herdr failed: %v; cannot safely stop candidate: %w; backup: %s", err, stopErr, f.path("backup"))
		}
		if restoreErr := writeHerdrFile(f.target, backup, 0755); restoreErr != nil {
			return errors.Join(err, restoreErr)
		}
		if restoreErr := writeHerdrJSON(f.path("install.json"), old); restoreErr != nil {
			return errors.Join(err, restoreErr)
		}
		tx.Phase = "rolled_back"
		if writeErr := writeHerdrJSON(f.path("update.json"), tx); writeErr != nil {
			return errors.Join(err, writeErr)
		}
		if restoreErr := a.start(old.Release.Version); restoreErr != nil {
			return fmt.Errorf("new Herdr failed: %v; old binary restored but service recovery failed: %w", err, restoreErr)
		}
		return fmt.Errorf("new Herdr failed: %w; old binary and service restored; stopped terminal processes may need recovery", err)
	}
	if err = os.Remove(f.path("update.json")); err != nil {
		return err
	}
	_ = os.Remove(f.path("candidate"))
	_ = os.Remove(f.path("backup"))
	fmt.Printf("Herdr %s is installed and running.\n", release.Version)
	return nil
}

func confirmHerdrRestart(old, next string, sessions []string) bool {
	tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return false
	}
	defer tty.Close()
	host, _ := os.Hostname()
	fmt.Fprintf(tty, "Update Herdr %s → %s on %s. Sessions: %s.\nStopping this service terminates its terminal processes; agents may need recovery. Restart now? [y/N] ", old, next, host, strings.Join(sessions, ", "))
	answer, err := bufio.NewReader(tty).ReadString('\n')
	return err == nil && (strings.EqualFold(strings.TrimSpace(answer), "y") || strings.EqualFold(strings.TrimSpace(answer), "yes"))
}

// This runs inside the existing service control lock. A foreground daemon is
// not ours to pause, even if it happens to use the same state directory.
func pausePairfobForHerdr(layout serviceLayout) (func() error, error) {
	noop := func() error { return nil }
	sock, err := admin.SocketPathIn(layout.StateDir)
	if err != nil {
		return nil, err
	}
	p, err := inspectLocalProcess(sock)
	if err != nil && !errors.Is(err, admin.ErrNotRunning) {
		return nil, err
	}
	if p != nil {
		defer p.peer.Close()
	}
	_, unitErr := os.Stat(layout.UnitPath)
	if errors.Is(unitErr, os.ErrNotExist) {
		if p != nil {
			return nil, errors.New("foreground Pairfob is running; stop it explicitly before updating Herdr")
		}
		return noop, nil
	}
	if unitErr != nil {
		return nil, unitErr
	}
	status, err := observeService(layout)
	if err != nil {
		return nil, err
	}
	if err = verifyServiceTarget(status, layout); err != nil {
		return nil, err
	}
	if status.State == "stopped" && p == nil {
		return noop, nil
	}
	if status.State != "running" || p == nil || p.legacy || p.peer.PID != status.PID {
		return nil, errors.New("Pairfob service state cannot be verified; inspect it before updating Herdr")
	}
	if err = processBelongsTo(p.info, layout); err != nil {
		return nil, err
	}
	resume := func() error { return reconcileInstalledService(layout, false, p.info.Version, func() {}) }
	if err = pauseUserService(layout, status); err != nil {
		return nil, err
	}
	if err = waitForProcessExit(p.peer.PID); err != nil {
		return nil, errors.Join(err, resume())
	}
	return resume, nil
}
