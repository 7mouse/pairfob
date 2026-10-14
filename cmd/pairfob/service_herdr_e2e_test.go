package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	runtimeapi "pairfob/internal/runtime"
)

// Add PAIRFOB_E2E_HERDR=1 to TestRealServiceRecovery to exercise the latest
// official runtime in its temporary HOME. Never use the user's runtime socket.
type realServiceHerdr struct {
	t        *testing.T
	runtime  *runtimeapi.Herdr
	home     string
	identity string
}

func prepareRealServiceHerdr(t *testing.T, home, binary string) *realServiceHerdr {
	t.Helper()
	if os.Getenv("PAIRFOB_E2E_HERDR") != "1" {
		return nil
	}
	for _, key := range []string{"HERDR_BIN", "HERDR_CONFIG_PATH", "HERDR_SOCKET_PATH", "HERDR_CLIENT_SOCKET_PATH", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "HERDR_ENV", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"} {
		t.Setenv(key, "")
		// Herdr distinguishes an absent path from an explicitly empty path.
		// Setenv first registers restoration of the user's original value.
		if err := os.Unsetenv(key); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
	t.Setenv("PAIRFOB_HERDR_AUTOSTART", "1")
	h := runtimeapi.NewHerdr(runtimeapi.DefaultSocket())
	if h.Socket != filepath.Join(home, ".config", "herdr", "herdr.sock") {
		t.Fatal("Herdr test socket escaped its temporary HOME")
	}
	fixture := &realServiceHerdr{t: t, runtime: h, home: home}
	// Registered before the test service's cleanup, so the daemon is removed
	// first and cannot relaunch the runtime during teardown.
	t.Cleanup(fixture.stop)
	// Optional cache uses production manifest validation and SHA/version checks.
	// The caller must fetch the manifest snapshot from the official endpoint.
	if artifact := os.Getenv("PAIRFOB_E2E_HERDR_ARTIFACT"); artifact != "" {
		var release herdrRelease
		var err error
		if manifest := os.Getenv("PAIRFOB_E2E_HERDR_MANIFEST"); manifest != "" {
			var data []byte
			data, err = os.ReadFile(manifest)
			if err == nil {
				release, err = parseHerdrRelease(data, runtime.GOOS, runtime.GOARCH)
			}
		} else {
			release, err = latestHerdrRelease(runtime.GOOS, runtime.GOARCH)
		}
		if err != nil {
			t.Fatal(err)
		}
		payload, err := os.ReadFile(artifact)
		if err != nil {
			t.Fatal(err)
		}
		files, err := localHerdrFiles()
		if err != nil {
			t.Fatal(err)
		}
		lock, err := files.lock()
		if err != nil {
			t.Fatal(err)
		}
		err = installHerdrRelease(files, release, payload)
		lock.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "setup", "--non-interactive")
	cmd.Dir = home
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("isolated Herdr setup: %v\n%s", err, out)
	} else {
		t.Logf("isolated setup: %s", out)
	}
	resolved, err := runtimeapi.ResolveHerdrBinary()
	if err != nil || resolved != filepath.Join(home, ".local", "bin", "herdr") {
		t.Fatalf("expected a private automatically installed Herdr, got %q: %v", resolved, err)
	}
	fixture.check("setup")
	return fixture
}

func (f *realServiceHerdr) check(phase string) {
	if f == nil {
		return
	}
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	installation := f.runtime.CheckInstallation(ctx)
	if installation.State != "ready" {
		f.t.Fatalf("%s: Herdr not ready: %+v", phase, installation)
	}
	identity, err := f.runtime.MaintenanceIdentity()
	if err != nil {
		f.t.Fatalf("%s: %v", phase, err)
	}
	if f.identity != "" && identity != f.identity {
		f.t.Fatalf("%s: Pairfob lifecycle unexpectedly replaced running Herdr", phase)
	}
	f.identity = identity
	receipt, err := f.runtime.Execute(ctx, runtimeapi.DefaultSession(), "service-create-"+phase, runtimeapi.CreateConversationCommand{CWD: f.home, Label: phase})
	if err != nil || receipt.Outcome != runtimeapi.OutcomeApplied {
		f.t.Fatalf("%s: create terminal: %+v %v", phase, receipt, err)
	}
	workspace := ""
	for _, entity := range receipt.Created {
		if entity.Kind == runtimeapi.EntityWorkspace {
			workspace = entity.ID
		}
	}
	if workspace == "" {
		f.t.Fatalf("%s: no created workspace", phase)
	}
	if _, err := f.runtime.Execute(ctx, runtimeapi.DefaultSession(), "service-close-"+phase, runtimeapi.CloseWorkspaceCommand{WorkspaceID: workspace}); err != nil {
		f.t.Fatal(err)
	}
	f.t.Logf("%s: Herdr %s ready; real terminal created and closed", phase, installation.Descriptor.Version)
}

func (f *realServiceHerdr) stop() {
	if f == nil {
		return
	}
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	state := f.runtime.CheckInstallation(ctx).State
	if state == "stopped" || state == "missing" {
		return
	}
	identity, err := f.runtime.MaintenanceIdentity()
	if err != nil {
		f.t.Errorf("identify isolated Herdr for cleanup: %v", err)
		return
	}
	if err := f.runtime.StopForMaintenance(ctx, identity); err != nil {
		f.t.Errorf("stop isolated Herdr: %v", err)
	}
	f.identity = ""
}
