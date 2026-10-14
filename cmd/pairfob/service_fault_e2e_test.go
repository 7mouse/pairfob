package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"pairfob/internal/admin"
)

// Exercise a crash rather than an orderly service restart. The caller has
// installed a uniquely named service with a private HOME and admin socket.
func verifyRealServiceCrashRecovery(t *testing.T, layout serviceLayout, sock string, before admin.ProcessInfo) {
	t.Helper()
	peer, err := inspectLocalProcess(sock)
	if err != nil {
		t.Fatal(err)
	}
	defer peer.peer.Close()
	if peer.info != before || before.Executable != layout.ExecPath {
		t.Fatal("isolated service identity changed before crash injection")
	}
	process, err := os.FindProcess(before.PID)
	if err != nil {
		t.Fatal(err)
	}
	if err := process.Kill(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		p, err := inspectLocalProcess(sock)
		if err == nil {
			info := p.info
			p.peer.Close()
			status, err := observeService(layout)
			if err == nil && status.State == "running" && status.PID == info.PID &&
				info.PID != before.PID && info.Instance != before.Instance && info.Executable == before.Executable {
				t.Logf("crash recovery: supervisor replaced PID %d with %d without a start command", before.PID, info.PID)
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	log, _ := os.ReadFile(layout.LogPath)
	t.Fatalf("isolated service did not recover from SIGKILL: %s", log)
}

// A rejecting local proxy makes download failure deterministic without changing
// host networking. Only child CLI processes receive the proxy configuration.
func (f *realServiceHerdr) checkUnavailableDownload(binary string) {
	if f == nil {
		return
	}
	f.t.Helper()
	var requests atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.t.Logf("rejected network request: %s %s", r.Method, r.Host)
		requests.Add(1)
		http.Error(w, "test download channel unavailable", http.StatusServiceUnavailable)
	}))
	defer proxy.Close()
	env := []string{}
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch strings.ToLower(key) {
		case "http_proxy", "https_proxy", "all_proxy", "no_proxy":
			continue
		}
		env = append(env, entry)
	}
	env = append(env, "HTTP_PROXY="+proxy.URL, "HTTPS_PROXY="+proxy.URL, "NO_PROXY=localhost,127.0.0.1,::1")
	run := func(want int, args ...string) string {
		f.t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, binary, args...)
		cmd.Dir, cmd.Env = f.home, env
		out, err := cmd.CombinedOutput()
		if cmd.ProcessState == nil || cmd.ProcessState.ExitCode() != want || ctx.Err() != nil {
			f.t.Fatalf("unavailable download %v: want exit %d, error %v: %s", args, want, err, out)
		}
		return string(out)
	}
	files, err := localHerdrFiles()
	if err != nil {
		f.t.Fatal(err)
	}
	paths := []string{files.target, files.path("install.json")}
	saved := make([][]byte, len(paths))
	for i, path := range paths {
		var err error
		saved[i], err = os.ReadFile(path)
		if err != nil {
			f.t.Fatal(err)
		}
	}
	out := run(1, "setup", "--update-herdr", "--non-interactive")
	if requests.Load() == 0 || !strings.Contains(out, "read latest stable Herdr release") {
		f.t.Fatalf("update did not report the injected download failure: %s", out)
	}
	for i, path := range paths {
		body, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(body, saved[i]) {
			f.t.Fatalf("failed update changed %s: %v", path, err)
		}
	}
	f.check("download-unavailable")
	// Stop only the fixture's verified runtime, then prove ordinary setup can
	// launch its installed binary while all proxied requests remain rejected.
	// Herdr itself can contact herdr.dev on startup; zero requests is not the
	// offline-availability contract. No downloaded bytes can pass this proxy.
	f.stop()
	run(0, "setup", "--non-interactive")
	for i, path := range paths {
		body, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(body, saved[i]) {
			f.t.Fatalf("offline cold start changed %s: %v", path, err)
		}
	}
	f.check("offline-cold-start")
	f.t.Log("unavailable download: update failed, binary/receipt preserved, local cold start succeeded with all proxy requests rejected")
}
