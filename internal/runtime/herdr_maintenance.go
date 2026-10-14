package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"pairfob/internal/admin"
)

// A local launch receipt is separate from installation ownership. An executable
// installed by Pairfob does not grant permission to stop an externally run server.
type herdrLaunchReceipt struct {
	PID     int    `json:"pid"`
	Started string `json:"started"`
	Socket  string `json:"socket"`
	Binary  string `json:"binary"`
}

func processStartStamp(pid int) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ps", "-p", fmt.Sprint(pid), "-o", "lstart=").Output()
	stamp := strings.TrimSpace(string(out))
	if err != nil || stamp == "" {
		return "", errors.New("cannot verify Herdr process start time")
	}
	return stamp, nil
}

func (h *Herdr) rememberLaunchedServer() {
	if h.Socket != FallbackSocket() {
		return
	}
	peer, err := admin.OpenPeer(h.Socket)
	if err != nil {
		return
	}
	defer peer.Close()
	stamp, err := processStartStamp(peer.PID)
	if err != nil {
		return
	}
	binary, err := h.resolveBinary()
	if err != nil {
		return
	}
	body, err := json.Marshal(herdrLaunchReceipt{peer.PID, stamp, h.Socket, binary})
	if err != nil {
		return
	}
	f, err := os.CreateTemp(h.ConfigRoot, ".pairfob-launch-*")
	if err != nil {
		return
	}
	defer f.Close()
	defer os.Remove(f.Name())
	if _, err = f.Write(body); err != nil {
		return
	}
	if err = f.Sync(); err != nil {
		return
	}
	if err = f.Close(); err != nil {
		return
	}
	_ = os.Rename(f.Name(), filepath.Join(h.ConfigRoot, ".pairfob-server.json"))
}

// MaintenanceServers checks every known local socket even when phone-facing
// multi-session discovery is disabled. A permission error is never "stopped".
func (h *Herdr) MaintenanceServers() ([]string, error) {
	paths := map[string]string{"default": h.Socket}
	entries, err := os.ReadDir(filepath.Join(h.ConfigRoot, "sessions"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	for _, entry := range entries {
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			paths[entry.Name()] = filepath.Join(h.ConfigRoot, "sessions", entry.Name(), "herdr.sock")
		}
	}
	var running []string
	for name, path := range paths {
		stopped, err := herdrSocketNeedsServer(path)
		if err != nil {
			return nil, fmt.Errorf("inspect Herdr session %s: %w", name, err)
		}
		if !stopped {
			running = append(running, name)
		}
	}
	return running, nil
}

func (h *Herdr) MaintenanceIdentity() (string, error) {
	peer, err := admin.OpenPeer(h.Socket)
	if err != nil {
		return "", err
	}
	defer peer.Close()
	path := filepath.Join(h.ConfigRoot, ".pairfob-server.json")
	file, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return "", errors.New("Herdr was not started by Pairfob; stop it using its original supervisor")
	}
	defer file.Close()
	st, err := file.Stat()
	if err != nil {
		return "", err
	}
	owner, ok := st.Sys().(*syscall.Stat_t)
	if !ok || owner.Uid != uint32(os.Getuid()) || owner.Nlink != 1 || !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 || st.Size() > 4096 {
		return "", errors.New("unsafe Herdr launch record")
	}
	data, err := io.ReadAll(io.LimitReader(file, 4096))
	if err != nil {
		return "", err
	}
	var record herdrLaunchReceipt
	if err = json.Unmarshal(data, &record); err != nil {
		return "", err
	}
	stamp, err := processStartStamp(peer.PID)
	if err != nil {
		return "", err
	}
	binary, err := h.resolveBinary()
	if err != nil {
		return "", err
	}
	if record.PID != peer.PID || record.Started != stamp || record.Socket != h.Socket || record.Binary != binary {
		return "", errors.New("Herdr process changed or is externally managed; maintain it locally")
	}
	return fmt.Sprintf("%d/%s", peer.PID, stamp), nil
}

func (h *Herdr) StopForMaintenance(ctx context.Context, identity string) error {
	current, err := h.MaintenanceIdentity()
	if err != nil {
		return err
	}
	if current != identity {
		return errors.New("Herdr changed after confirmation; run setup again")
	}
	binary, err := h.resolveBinary()
	if err != nil {
		return err
	}
	out, err := exec.CommandContext(ctx, binary, "server", "stop").CombinedOutput()
	if err != nil {
		return fmt.Errorf("stop Herdr: %w: %s", err, strings.TrimSpace(string(out)))
	}
	for {
		stopped, err := herdrSocketNeedsServer(h.Socket)
		if err != nil {
			return err
		}
		if stopped {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}
