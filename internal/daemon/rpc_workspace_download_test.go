package daemon

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"

	"pairfob/internal/phone"
	"pairfob/internal/workspace"
)

func markPhoneSessionP2P(t *testing.T, engine *Engine, client *phone.Client) {
	t.Helper()
	engine.mu.Lock()
	defer engine.mu.Unlock()
	route, ok := engine.byDevice[client.DeviceID]
	if !ok {
		t.Fatalf("no active session for %s", client.DeviceID)
	}
	session := engine.sessions[route]
	if session == nil || session.state != "established" {
		t.Fatalf("session %x is not established", route)
	}
	session.transport = "p2p"
}

func writeDownloadFixture(t *testing.T, root, name string, size int64, head byte, tail byte) {
	t.Helper()
	file, err := os.Create(filepath.Join(root, name))
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(size); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	headLen := int64(64 * 1024)
	if headLen > size {
		headLen = size
	}
	if _, err := file.WriteAt(bytes.Repeat([]byte{head}, int(headLen)), 0); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if size > 64*1024 {
		if _, err := file.WriteAt(bytes.Repeat([]byte{tail}, 64*1024), size-64*1024); err != nil {
			_ = file.Close()
			t.Fatal(err)
		}
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func openDownload(t *testing.T, client *phone.Client, path string) map[string]any {
	t.Helper()
	raw, err := client.RPCTimeout("WorkspaceDownloadOpen", map[string]any{"pane_id": "w0:p1", "path": path}, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	return decodeResult(t, raw)
}

func readDownload(t *testing.T, client *phone.Client, handle string, offset, length int64) ([]byte, bool) {
	t.Helper()
	raw, err := client.RPCTimeout("WorkspaceDownloadRead", map[string]any{
		"handle": handle, "offset": offset, "length": length,
	}, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	result := decodeResult(t, raw)
	decoded, err := base64.StdEncoding.DecodeString(result["bytes"].(string))
	if err != nil {
		t.Fatal(err)
	}
	return decoded, result["eof"] == true
}

func TestWorkspaceDownloadRequiresP2P(t *testing.T) {
	root, fake := workspaceRPCFixture(t)
	writeDownloadFixture(t, root, "small.bin", 1024, 1, 2)
	engine, client := runtimeRPCClient(t, fake)
	if _, err := client.RPC("WorkspaceDownloadOpen", map[string]any{"pane_id": "w0:p1", "path": "small.bin"}); err == nil || err.Error() != "forbidden" {
		t.Fatalf("relay download err=%v want forbidden", err)
	}
	markPhoneSessionP2P(t, engine, client)
	opened := openDownload(t, client, "small.bin")
	if opened["path"] != "small.bin" || opened["size"] != float64(1024) || opened["chunk_bytes"] != float64(workspace.MediaChunkBytes) {
		t.Fatalf("opened=%v", opened)
	}
	handle := opened["handle"].(string)
	engine.mu.Lock()
	session := engine.sessions[engine.byDevice[client.DeviceID]]
	session.transport = "relay"
	engine.mu.Unlock()
	if _, err := client.RPC("WorkspaceDownloadRead", map[string]any{
		"handle": handle, "offset": 0, "length": 1,
	}); err == nil || err.Error() != "forbidden" {
		t.Fatalf("read after losing P2P err=%v want forbidden", err)
	}
}

func TestWorkspaceDownloadReadsBeyondThePreviewCap(t *testing.T) {
	root, fake := workspaceRPCFixture(t)
	const size = int64(34 << 20) // above the 32 MiB preview media cap
	writeDownloadFixture(t, root, "artifact.bin", size, 'a', 'z')
	engine, client := runtimeRPCClient(t, fake)
	markPhoneSessionP2P(t, engine, client)

	opened := openDownload(t, client, "artifact.bin")
	handle := opened["handle"].(string)
	if opened["size"] != float64(size) || opened["max_bytes"] != float64(workspace.MaxDownloadBytes) {
		t.Fatalf("opened=%v", opened)
	}
	if revision, _ := opened["revision"].(string); len(revision) != 64 {
		t.Fatalf("revision=%v", opened["revision"])
	}
	head, eof := readDownload(t, client, handle, 0, workspace.MediaChunkBytes)
	if eof || len(head) != workspace.MediaChunkBytes || head[0] != 'a' {
		t.Fatalf("head len=%d eof=%v first=%x", len(head), eof, head[0])
	}
	tail, eof := readDownload(t, client, handle, size-workspace.MediaChunkBytes, workspace.MediaChunkBytes)
	if !eof || len(tail) != workspace.MediaChunkBytes || tail[len(tail)-1] != 'z' {
		t.Fatalf("tail len=%d eof=%v last=%x", len(tail), eof, tail[len(tail)-1])
	}
	if _, err := client.RPC("WorkspaceDownloadClose", map[string]any{"handle": handle}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.RPC("WorkspaceDownloadClose", map[string]any{"handle": handle}); err != nil {
		t.Fatalf("idempotent close: %v", err)
	}
}

func TestWorkspaceDownloadReadsAWholeSmallFile(t *testing.T) {
	root, fake := workspaceRPCFixture(t)
	payload := bytes.Repeat([]byte("download-payload\n"), 1024)
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), payload, 0o644); err != nil {
		t.Fatal(err)
	}
	engine, client := runtimeRPCClient(t, fake)
	markPhoneSessionP2P(t, engine, client)
	handle := openDownload(t, client, "notes.txt")["handle"].(string)
	var got []byte
	for offset := int64(0); ; {
		chunk, eof := readDownload(t, client, handle, offset, workspace.MediaChunkBytes)
		got = append(got, chunk...)
		offset += int64(len(chunk))
		if eof {
			break
		}
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("downloaded %d bytes, want %d", len(got), len(payload))
	}
}

func TestWorkspaceDownloadOpenAtRootPinsTheRoot(t *testing.T) {
	root, fake := workspaceRPCFixture(t)
	writeDownloadFixture(t, root, "pinned.bin", 512, 3, 4)
	engine, client := runtimeRPCClient(t, fake)
	markPhoneSessionP2P(t, engine, client)
	canon, err := workspace.CanonicalRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := client.RPC("WorkspaceDownloadOpenAtRoot", map[string]any{
		"pane_id": "w0:p1", "root": canon, "path": "pinned.bin",
	})
	if err != nil {
		t.Fatal(err)
	}
	if decodeResult(t, raw)["path"] != "pinned.bin" {
		t.Fatalf("open=%s", raw)
	}
	sub, err := workspace.CanonicalRoot(filepath.Join(root, "src"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.RPC("WorkspaceDownloadOpenAtRoot", map[string]any{
		"pane_id": "w0:p1", "root": sub, "path": "pinned.bin",
	}); err == nil || err.Error() != "conflict" {
		t.Fatalf("wrong root err=%v want conflict", err)
	}
}

func TestWorkspaceDownloadRejectsMediaHandles(t *testing.T) {
	root, fake := workspaceRPCFixture(t)
	mediaPNG(t, root, "cat.png", tinyPNG())
	writeDownloadFixture(t, root, "small.bin", 32, 5, 6)
	engine, client := runtimeRPCClient(t, fake)
	markPhoneSessionP2P(t, engine, client)
	mediaHandle := openMedia(t, client, "cat.png")["handle"].(string)
	if _, err := client.RPC("WorkspaceDownloadRead", map[string]any{
		"handle": mediaHandle, "offset": 0, "length": 1,
	}); err == nil || err.Error() != "invalid_argument" {
		t.Fatalf("download read of media handle err=%v", err)
	}
	downloadHandle := openDownload(t, client, "small.bin")["handle"].(string)
	if _, err := client.RPC("WorkspaceMediaRead", map[string]any{
		"handle": downloadHandle, "offset": 0, "length": 1,
	}); err == nil || err.Error() != "invalid_argument" {
		t.Fatalf("media read of download handle err=%v", err)
	}
}

func TestWorkspaceDownloadRejectsOverCapBeforeRead(t *testing.T) {
	root, fake := workspaceRPCFixture(t)
	file, err := os.Create(filepath.Join(root, "huge.bin"))
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(workspace.MaxDownloadBytes + 1); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	engine, client := runtimeRPCClient(t, fake)
	markPhoneSessionP2P(t, engine, client)
	if _, err := client.RPCTimeout("WorkspaceDownloadOpen", map[string]any{"pane_id": "w0:p1", "path": "huge.bin"}, 30*time.Second); err == nil || err.Error() != "too_large" {
		t.Fatalf("over-cap err=%v want too_large", err)
	}
}

func TestWorkspaceDownloadRejectsAChangedFile(t *testing.T) {
	root, fake := workspaceRPCFixture(t)
	writeDownloadFixture(t, root, "changing.bin", 1<<20, 'a', 'b')
	engine, client := runtimeRPCClient(t, fake)
	markPhoneSessionP2P(t, engine, client)
	handle := openDownload(t, client, "changing.bin")["handle"].(string)
	if err := os.WriteFile(filepath.Join(root, "changing.bin"), []byte("replaced"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := client.RPC("WorkspaceDownloadRead", map[string]any{
		"handle": handle, "offset": 0, "length": 1,
	}); err == nil || err.Error() != "conflict" {
		t.Fatalf("changed file err=%v want conflict", err)
	}
}

func TestWorkspaceDownloadHandleLimit(t *testing.T) {
	root, fake := workspaceRPCFixture(t)
	writeDownloadFixture(t, root, "a.bin", 32, 1, 1)
	writeDownloadFixture(t, root, "b.bin", 32, 2, 2)
	writeDownloadFixture(t, root, "c.bin", 32, 3, 3)
	engine, client := runtimeRPCClient(t, fake)
	markPhoneSessionP2P(t, engine, client)
	openDownload(t, client, "a.bin")
	openDownload(t, client, "b.bin")
	if _, err := client.RPC("WorkspaceDownloadOpen", map[string]any{"pane_id": "w0:p1", "path": "c.bin"}); err == nil || err.Error() != "rate_limited" {
		t.Fatalf("third handle err=%v want rate_limited", err)
	}
}

func TestWorkspaceDownloadContextCancelDoesNotLeak(t *testing.T) {
	root, fake := workspaceRPCFixture(t)
	writeDownloadFixture(t, root, "small.bin", 32, 1, 2)
	engine, client := runtimeRPCClient(t, fake)
	markPhoneSessionP2P(t, engine, client)
	opened := openDownload(t, client, "small.bin")
	handle := opened["handle"].(string)
	engine.downloadLiveContextMustCancel(t, client.DeviceID, handle)
}

// downloadLiveContextMustCancel is a small test knife: a live handle keeps
// both the session context and the quota maps alive, and closing the session
// releases exactly those maps.
func (e *Engine) downloadLiveContextMustCancel(t *testing.T, deviceID, handle string) {
	t.Helper()
	e.mu.Lock()
	route := e.byDevice[deviceID]
	session := e.sessions[route]
	e.mu.Unlock()
	if session == nil {
		t.Fatal("missing session")
	}
	if _, err := e.downloadLiveContext(session); err != nil {
		t.Fatal(err)
	}
	if h, ok := e.mediaLookup(session, handle); !ok || h.purpose != purposeDownload {
		t.Fatal("download handle not installed")
	}
	e.closeSession(route, "", false)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		e.media.mu.Lock()
		_, ctxLive := e.media.ctxs[session]
		handles := len(e.media.bySession[session])
		e.media.mu.Unlock()
		quotaLive := e.media.downloadBandwidth.sessionLive(session)
		if !ctxLive && !quotaLive && handles == 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("download session state did not drain")
}
