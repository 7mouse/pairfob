package daemon

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"time"

	"pairfob/internal/workspace"
)

var downloadHandleName = regexp.MustCompile(downloadHandlePattern)

func (e *Engine) dispatchWorkspaceDownload(s *sess, id, op string, params json.RawMessage) {
	if op == "WorkspaceDownloadClose" {
		e.rpcWorkspaceDownloadClose(s, id, params)
		return
	}
	select {
	case downloadRPCSlots <- struct{}{}:
		defer func() { <-downloadRPCSlots }()
	default:
		e.replyErr(s, id, "rate_limited", "too many download reads are already running")
		return
	}
	switch op {
	case "WorkspaceDownloadOpenAtRoot":
		e.rpcWorkspaceBound(s, id, op, params)
	case "WorkspaceDownloadOpen":
		e.rpcWorkspaceDownloadOpen(s, id, params)
	case "WorkspaceDownloadRead":
		e.rpcWorkspaceDownloadRead(s, id, params)
	default:
		e.replyErr(s, id, "unknown_op", op)
	}
}

func (e *Engine) p2pEstablished(s *sess) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return s != nil && s.state == "established" && s.transport == "p2p" && e.sessions[s.routeID] == s
}

// downloadLiveContext binds the download budget to the same logical session
// that owns preview media. A P2P commit keeps the *sess owner, so the quota
// follows the session across the route change.
func (e *Engine) downloadLiveContext(s *sess) (context.Context, error) {
	e.media.mu.Lock()
	defer e.media.mu.Unlock()
	e.mu.Lock()
	live := s != nil && s.state == "established" && e.sessions[s.routeID] == s
	e.mu.Unlock()
	if !live {
		return nil, errMediaClosed
	}
	ctx := e.media.ctxs[s]
	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithCancel(context.Background())
		if err := e.media.bandwidth.bind(s); err != nil {
			cancel()
			return nil, err
		}
		if err := e.media.downloadBandwidth.bind(s); err != nil {
			cancel()
			e.media.bandwidth.dropSession(s)
			return nil, err
		}
		e.media.ctxs[s] = ctx
		e.media.cancels[s] = cancel
		return ctx, nil
	}
	if err := e.media.downloadBandwidth.bind(s); err != nil {
		return nil, err
	}
	return ctx, nil
}

func (e *Engine) replyDownloadErr(s *sess, id string, err error) {
	switch {
	case errors.Is(err, workspace.ErrInvalidPath):
		e.replyErr(s, id, "forbidden", "workspace path is outside the live pane root")
	case errors.Is(err, workspace.ErrNotFound), errors.Is(err, workspace.ErrNotDirectory):
		e.replyErr(s, id, "workspace_not_found", "workspace target is no longer available")
	case errors.Is(err, workspace.ErrTooLarge):
		e.replyErr(s, id, "too_large", "file exceeds the download size limit")
	case errors.Is(err, workspace.ErrChanged):
		e.replyErr(s, id, "conflict", "the file changed; reopen it")
	case errors.Is(err, workspace.ErrInvalidRange):
		e.replyErr(s, id, "invalid_argument", "invalid download read range")
	case errors.Is(err, errMediaQuota), errors.Is(err, errMediaRate), errors.Is(err, context.DeadlineExceeded):
		e.replyErr(s, id, "rate_limited", err.Error())
	case errors.Is(err, errMediaClosed), errors.Is(err, context.Canceled):
		e.replyErr(s, id, "workspace_not_found", "download session is no longer established")
	default:
		e.replyErr(s, id, "internal", "workspace download failed")
	}
}

func (e *Engine) rpcWorkspaceDownloadOpen(s *sess, id string, params json.RawMessage, expectedRoot ...string) {
	var p struct {
		workspacePaneParams
		Path string `json:"path"`
	}
	if badParams(params, &p) || !validWorkspaceRelativePath(p.Path, false) {
		e.replyErr(s, id, "invalid_argument", "invalid workspace download request")
		return
	}
	if !e.p2pEstablished(s) {
		e.replyErr(s, id, "forbidden", "file downloads require a P2P direct connection")
		return
	}
	root, ok := e.workspaceReadTarget(s, id, p.workspacePaneParams, expectedRoot)
	if !ok {
		return
	}
	canon, err := workspace.CanonicalRoot(root)
	if err != nil {
		e.replyDownloadErr(s, id, err)
		return
	}
	base, err := e.downloadLiveContext(s)
	if err != nil {
		e.replyDownloadErr(s, id, err)
		return
	}
	ctx, cancel := context.WithTimeout(base, mediaOpenDeadline)
	defer cancel()
	admit := func(ctx context.Context, n int64) error {
		return e.media.downloadBandwidth.admit(ctx, s, mediaQuotaDisk, n)
	}
	file, err := workspace.NewInspector().OpenDownloadContext(ctx, canon, p.Path, workspace.MaxDownloadBytes, admit)
	if err != nil {
		e.replyDownloadErr(s, id, err)
		return
	}
	if err := ctx.Err(); err != nil {
		_ = file.Close()
		e.replyDownloadErr(s, id, err)
		return
	}
	handleID, err := newDownloadHandleID()
	if err != nil {
		_ = file.Close()
		e.replyErr(s, id, "internal", "could not create download handle")
		return
	}
	now := time.Now()
	h := &mediaHandle{
		id: handleID, session: s, rpcSession: p.Session, route: s.routeID, paneID: p.PaneID,
		root: canon, relPath: file.Info().Path, purpose: purposeDownload,
		idle: downloadHandleIdle, ttl: downloadHandleTTL,
		file: file, opened: now, deadline: now.Add(downloadHandleIdle),
	}
	if err := e.mediaPut(h); err != nil {
		_ = file.Close()
		e.replyDownloadErr(s, id, err)
		return
	}
	info := file.Info()
	e.audit("download_open", map[string]any{
		"device_id": s.deviceID, "pane_id": p.PaneID, "path": info.Path, "size": info.Size,
	})
	if !e.reply(s, id, map[string]any{
		"handle": handleID, "path": info.Path, "kind": info.Kind, "mime": info.MIME,
		"size": info.Size, "modified_ms": info.ModifiedMS, "revision": info.Revision,
		"expires_ms": h.deadline.UnixMilli(), "chunk_bytes": workspace.MediaChunkBytes,
		"max_bytes": info.MaxBytes,
	}) {
		if dropped := e.mediaDrop(s, handleID); dropped != nil {
			_ = dropped.file.Close()
		}
	}
}

func (e *Engine) rpcWorkspaceDownloadRead(s *sess, id string, params json.RawMessage) {
	var p struct {
		Handle string `json:"handle"`
		Offset *int64 `json:"offset"`
		Length *int64 `json:"length"`
	}
	if badParams(params, &p) || !downloadHandleName.MatchString(p.Handle) {
		e.replyErr(s, id, "invalid_argument", "invalid download read request")
		return
	}
	if p.Offset == nil || p.Length == nil || *p.Offset < 0 ||
		*p.Length < 1 || *p.Length > workspace.MediaChunkBytes {
		e.replyErr(s, id, "invalid_argument", "missing or invalid download read offset/length")
		return
	}
	offset, length := *p.Offset, *p.Length
	if !e.p2pEstablished(s) {
		e.replyErr(s, id, "forbidden", "file downloads require a P2P direct connection")
		return
	}
	h, ok := e.mediaLookup(s, p.Handle)
	if !ok || h.purpose != purposeDownload {
		e.replyErr(s, id, "workspace_not_found", "download handle is no longer available")
		return
	}
	size := h.file.Info().Size
	if offset > size {
		e.replyDownloadErr(s, id, workspace.ErrInvalidRange)
		return
	}
	if err := e.mediaRevalidate(s, h); err != nil {
		e.replyDownloadErr(s, id, err)
		return
	}
	if !h.reading.CompareAndSwap(false, true) {
		e.replyErr(s, id, "rate_limited", "a download chunk is already in flight")
		return
	}
	defer h.reading.Store(false)
	base, err := e.downloadLiveContext(s)
	if err != nil {
		e.replyDownloadErr(s, id, err)
		return
	}
	remain := size - offset
	if remain < 0 {
		remain = 0
	}
	want := length
	if want > remain {
		want = remain
	}
	if want > 0 {
		if err := e.media.downloadBandwidth.admit(base, s, mediaQuotaDisk, want); err != nil {
			e.replyDownloadErr(s, id, err)
			return
		}
		if err := e.mediaRevalidate(s, h); err != nil {
			e.replyDownloadErr(s, id, err)
			return
		}
	}
	chunk, eof, err := h.file.ReadChunk(offset, length)
	if err != nil {
		e.replyDownloadErr(s, id, err)
		return
	}
	if cost := mediaNetCost(len(chunk)); cost > 0 {
		if err := e.media.downloadBandwidth.admit(base, s, mediaQuotaNet, cost); err != nil {
			e.replyDownloadErr(s, id, err)
			return
		}
		if err := e.mediaRevalidate(s, h); err != nil {
			e.replyDownloadErr(s, id, err)
			return
		}
	}
	encoded := base64.StdEncoding.EncodeToString(chunk)
	e.replyMediaAuthorized(s, id, map[string]any{
		"handle": h.id, "offset": offset, "length": len(chunk), "bytes": encoded, "eof": eof,
	}, h)
}

func (e *Engine) rpcWorkspaceDownloadClose(s *sess, id string, params json.RawMessage) {
	var p struct {
		Handle string `json:"handle"`
	}
	if badParams(params, &p) || !downloadHandleName.MatchString(p.Handle) {
		e.replyErr(s, id, "invalid_argument", "invalid download close request")
		return
	}
	h := e.mediaDrop(s, p.Handle)
	if h != nil && h.session == s {
		_ = h.file.Close()
	}
	e.reply(s, id, map[string]any{"handle": p.Handle, "closed": true})
}
