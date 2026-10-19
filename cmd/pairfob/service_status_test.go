package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServiceStatusWithoutManager(t *testing.T) {
	for _, name := range []string{"matching", "old version", "replaced image", "legacy", "stopped", "other instance"} {
		t.Run(name, func(t *testing.T) {
			layout, sock := lifecycleFixture(t)
			layout.GOOS = "linux"
			calls := 0
			stubServiceRunner(t, func(args []string) ([]byte, error) {
				calls++
				if len(args) < 3 || args[0] != "systemctl" || args[1] != "--user" || args[2] != "show" {
					t.Fatalf("status attempted service control: %v", args)
				}
				return []byte("Failed to connect to bus: No medium found"), errors.New("exit status 1")
			})
			build := version
			if name == "old version" {
				build = "old-build"
			}
			var child *lifecycleChild
			if name == "replaced image" {
				image, err := os.ReadFile(os.Args[0])
				if err != nil {
					t.Fatal(err)
				}
				layout.ExecPath = filepath.Join(layout.StateDir, "pairfob")
				if err := os.WriteFile(layout.ExecPath, image, 0700); err != nil {
					t.Fatal(err)
				}
				child = startLifecycleExecutable(t, layout.ExecPath, layout.StateDir, sock, build, false)
				if err := replaceExecutable(layout.ExecPath, append(image, '\n')); err != nil {
					t.Fatal(err)
				}
			} else if name != "stopped" {
				child = startLifecycleChild(t, layout.StateDir, sock, build, name == "legacy")
			}
			if name == "other instance" {
				layout.StateDir = t.TempDir() // The socket override still points at the child.
			}
			var out bytes.Buffer
			err := writeServiceStatus(&out, layout)
			if err == nil {
				t.Fatal("unavailable service manager reported success")
			}
			for _, want := range []string{"Service     unavailable", "Failed to connect to bus: No medium found", "Installed   " + version} {
				if !strings.Contains(out.String(), want) {
					t.Fatalf("missing %q in %s", want, out.String())
				}
			}
			wantError := ""
			switch name {
			case "matching":
				wantError = "service ownership unknown"
				if !strings.Contains(out.String(), "installed and running programs match") {
					t.Fatalf("missing image comparison: %s", out.String())
				}
			case "old version", "replaced image":
				wantError = "installed and running programs differ; stop the existing daemon with your supervisor, then start pairfob run"
			case "legacy":
				wantError = "running version cannot be verified; stop the existing daemon with your supervisor, then start pairfob run"
			case "stopped":
				wantError = "run pairfob run in the foreground"
				if !strings.Contains(out.String(), "Daemon      not running") {
					t.Fatalf("missing stopped daemon: %s", out.String())
				}
			case "other instance":
				wantError = "another Pairfob instance owns the socket"
			}
			if !strings.Contains(err.Error(), wantError) || strings.Contains(err.Error(), "pairfob service") {
				t.Fatalf("unhelpful diagnostic: %v", err)
			}
			if child != nil {
				if !strings.Contains(out.String(), fmt.Sprintf("PID %d", child.cmd.Process.Pid)) {
					t.Fatalf("missing daemon PID: %s", out.String())
				}
				if name != "legacy" && (!strings.Contains(out.String(), "Daemon      "+build) || !strings.Contains(out.String(), "Executable  ")) {
					t.Fatalf("missing running image: %s", out.String())
				}
				if !daemonIsLive(sock) {
					t.Fatal("status stopped the existing daemon")
				}
			}
			if calls != 1 {
				t.Fatalf("service observations=%d, want 1", calls)
			}
		})
	}
}
