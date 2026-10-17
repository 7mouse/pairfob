package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func termuxLayoutFixture(t *testing.T) serviceLayout {
	t.Helper()
	dir := t.TempDir()
	prefix := filepath.Join(dir, "usr")
	if err := os.MkdirAll(filepath.Join(prefix, "etc", "termux"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PREFIX", prefix)
	t.Setenv("TERMUX_VERSION", "")
	t.Setenv("HOME", dir)
	t.Setenv("PAIRFOB_STATE_DIR", filepath.Join(dir, "state"))
	return serviceLayout{
		GOOS:     "termux",
		ExecPath: filepath.Join(dir, "bin", "pairfob"),
		Home:     dir,
		StateDir: filepath.Join(dir, "state"),
		LogPath:  filepath.Join(dir, "state", "pairfob.log"),
		UnitPath: filepath.Join(prefix, "var", "service", "pairfob", "run"),
	}
}

func TestTermuxCurrentServiceLayoutUsesRunitDirectory(t *testing.T) {
	layout := termuxLayoutFixture(t)
	got, err := currentServiceLayout()
	if err != nil {
		t.Fatal(err)
	}
	if got.GOOS != "termux" || got.UnitPath != layout.UnitPath {
		t.Fatalf("%+v", got)
	}
}

func TestTermuxRunScriptQuotesRuntimeSettings(t *testing.T) {
	layout := termuxLayoutFixture(t)
	state := filepath.Join(layout.Home, "state with 'quote'")
	t.Setenv("PAIRFOB_STATE_DIR", state)
	t.Setenv("PAIRFOB_JOIN_GRANT", "jg_secret")
	body := termuxRunScript(layout)
	for _, want := range []string{
		"# pairfob-exec: " + strconv.Quote(layout.ExecPath),
		"export HOME='" + layout.Home + "'",
		"export PAIRFOB_STATE_DIR='" + strings.ReplaceAll(state, "'", `'\''`) + "'",
		"exec '" + layout.ExecPath + "' >>'" + layout.LogPath + "' 2>&1",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %q in %s", want, body)
		}
	}
	if strings.Contains(body, "JOIN_GRANT") {
		t.Fatal(body)
	}
}

func TestTermuxUnitRuntimeRoundTripsExports(t *testing.T) {
	layout := termuxLayoutFixture(t)
	t.Setenv("PAIRFOB_STATE_DIR", filepath.Join(layout.Home, "state"))
	body := []byte(termuxRunScript(layout))
	got, err := termuxUnitRuntime(body)
	if err != nil {
		t.Fatal(err)
	}
	if got.env["HOME"] != layout.Home || got.env["PAIRFOB_STATE_DIR"] != filepath.Join(layout.Home, "state") {
		t.Fatalf("%v", got.env)
	}
	if _, err := termuxUnitRuntime([]byte("#!/bin/sh\nexec pairfob\n")); err == nil {
		t.Fatal("handwritten script was accepted")
	}
}

func TestTermuxConfiguredExecutableReadsMarker(t *testing.T) {
	layout := termuxLayoutFixture(t)
	if err := os.MkdirAll(filepath.Dir(layout.UnitPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(layout.UnitPath, []byte(termuxRunScript(layout)), 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := termuxConfiguredExecutable(layout)
	if err != nil || got != layout.ExecPath {
		t.Fatalf("%q %v", got, err)
	}
	if err := os.WriteFile(layout.UnitPath, []byte("exec /tmp/other\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := termuxConfiguredExecutable(layout); err == nil {
		t.Fatal("markerless script was accepted")
	}
}

func TestParseTermuxObservation(t *testing.T) {
	for _, test := range []struct {
		out   string
		state string
		pid   int
	}{
		{"run: pairfob: (pid 1234) 12s", "running", 1234},
		{"down: pairfob: 1s, normally up", "stopped", 0},
		{"run: pairfob: 2s", "starting", 0},
		{"fail: pairfob: unable to change to service directory", "stopped", 0},
	} {
		got, err := parseTermuxObservation(test.out)
		if err != nil {
			t.Fatal(err)
		}
		if got.State != test.state || got.PID != test.pid {
			t.Fatalf("%q -> %+v", test.out, got)
		}
	}
	if _, err := parseTermuxObservation("warning: pairfob: unable to open supervise/ok"); err == nil {
		t.Fatal("unexpected status accepted")
	}
}

func TestServiceCommandsTermuxUsesSv(t *testing.T) {
	for action, want := range map[string]string{
		"install":   "sv -w 30 up pairfob",
		"start":     "sv -w 30 up pairfob",
		"restart":   "sv -w 30 restart pairfob",
		"stop":      "sv -w 30 down pairfob",
		"uninstall": "sv -w 30 down pairfob",
		"status":    "sv status pairfob",
	} {
		cmds := serviceCommands(serviceLayout{GOOS: "termux"}, action)
		if len(cmds) != 1 || strings.Join(cmds[0], " ") != want {
			t.Fatalf("%s -> %v", action, cmds)
		}
	}
}

func TestServiceHintSupportsTermux(t *testing.T) {
	layout := termuxLayoutFixture(t)
	if err := os.MkdirAll(filepath.Dir(layout.UnitPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(layout.UnitPath, []byte(termuxRunScript(layout)), 0o755); err != nil {
		t.Fatal(err)
	}
	previous := runServiceCommand
	t.Cleanup(func() { runServiceCommand = previous })
	runServiceCommand = func(args []string) ([]byte, error) {
		return []byte("run: pairfob: (pid 99) 3s"), nil
	}
	hint := recoveryHint(layout, nil)
	if hint.Command != "pairfob service restart" {
		t.Fatalf("%+v", hint)
	}
}
