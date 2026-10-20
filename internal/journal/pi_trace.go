package journal

// Serves one Pi session as history, trace and detail pages: cursors, bounded
// pages, and detail locators that resolve against the same session tree.

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
)

type piCursor struct {
	Version     int    `json:"v"`
	Ref         string `json:"r"`
	Session     string `json:"s"`
	Incarnation string `json:"i"`
	Entry       string `json:"e"`
	Ordinal     int    `json:"o"`
}

func encodePiCursor(ref Ref, session *piSession, entry string, ordinal int) string {
	raw, _ := json.Marshal(piCursor{Version: 1, Ref: refFingerprint(ref), Session: session.id, Incarnation: session.incarnation, Entry: entry, Ordinal: ordinal})
	return base64.RawURLEncoding.EncodeToString(raw)
}
func decodePiCursor(ref Ref, session *piSession, raw *string) (*piCursor, error) {
	if raw == nil {
		return nil, nil
	}
	if len(*raw) > 1024 {
		return nil, ErrCursorInvalid
	}
	data, err := base64.RawURLEncoding.DecodeString(*raw)
	if err != nil {
		return nil, ErrCursorInvalid
	}
	var cursor piCursor
	if json.Unmarshal(data, &cursor) != nil || cursor.Version != 1 || cursor.Ref != refFingerprint(ref) || cursor.Session != session.id || cursor.Incarnation != session.incarnation || cursor.Entry == "" || cursor.Ordinal < 0 || cursor.Ordinal > 1024 {
		return nil, ErrCursorConflict
	}
	if !session.branchSet[cursor.Entry] {
		return nil, ErrCursorConflict
	}
	return &cursor, nil
}

func (r *Reader) readPiHistory(ref Ref, cursor *string, limit int) (Page, error) {
	if limit == 0 {
		limit = 50
	}
	if limit < 1 || limit > 200 {
		return Page{}, errors.New("invalid history limit")
	}
	s, err := r.loadPiSession(ref, true)
	if err != nil {
		return Page{}, err
	}
	decoded, err := decodePiCursor(ref, s, cursor)
	if err != nil {
		return Page{}, err
	}
	type indexedMessage struct {
		message     Message
		branchIndex int
	}
	var all []indexedMessage
	for branchIndex, entry := range s.branch {
		if entry.Type == "custom_message" && entry.Display {
			if text := piText(entry.Content); text != "" {
				all = append(all, indexedMessage{Message{Role: "assistant", Text: "[Extension] " + text}, branchIndex})
			}
			continue
		}
		if entry.Type != "message" {
			continue
		}
		var msg piMessage
		if json.Unmarshal(entry.Message, &msg) != nil {
			continue
		}
		if msg.Role == "user" || msg.Role == "assistant" {
			text := piText(msg.Content)
			if msg.Role == "user" {
				text = piUserText(msg.Content)
			}
			if text != "" {
				all = append(all, indexedMessage{Message{Role: msg.Role, Text: text}, branchIndex})
			}
		}
	}
	end := len(all)
	if decoded != nil {
		end = -1
		for i, item := range all {
			if s.branch[item.branchIndex].ID == decoded.Entry && decoded.Ordinal == 0 {
				end = i
				break
			}
		}
		if end < 0 {
			return Page{}, ErrCursorConflict
		}
	}
	all = all[:end]
	start := len(all)
	pageBytes := 0
	hadClipping := false
	for start > 0 && len(all)-start < limit {
		candidate := all[start-1].message
		var clipped bool
		candidate.Text, clipped = clip(candidate.Text, maxMessageBytes, false)
		hadClipping = hadClipping || clipped
		encoded, _ := json.Marshal(candidate)
		if pageBytes+len(encoded) > maxPageItemsBytes {
			break
		}
		all[start-1].message = candidate
		pageBytes += len(encoded)
		start--
	}
	page := Page{Messages: make([]Message, 0, len(all)-start), Truncated: hadClipping || (start > 0 && pageBytes == 0)}
	for _, item := range all[start:] {
		page.Messages = append(page.Messages, item.message)
	}
	if start > 0 {
		next := encodePiCursor(ref, s, s.branch[all[start].branchIndex].ID, 0)
		page.NextCursor = &next
	}
	return page, nil
}

func (r *Reader) readPiTrace(ref Ref, cursor *string, limit int, options TraceOptions) (TracePage, error) {
	s, err := r.loadPiSession(ref, true)
	if err != nil {
		return TracePage{}, err
	}
	decoded, err := decodePiCursor(ref, s, cursor)
	if err != nil {
		return TracePage{}, err
	}
	var events []parsedEvent
	for _, event := range piEvents(s, options.Models) {
		if event, keep := options.adapt(event); keep {
			events = append(events, event)
		}
	}
	end := len(events)
	if decoded != nil {
		end = -1
		for i, event := range events {
			if s.branch[event.lineStart].ID == decoded.Entry && event.sourceOrdinal == decoded.Ordinal {
				end = i
				break
			}
		}
		if end < 0 {
			return TracePage{}, ErrCursorConflict
		}
	}
	events = events[:end]
	start := len(events)
	pageBytes := 0
	for start > 0 && len(events)-start < limit {
		candidate, _ := clipEvent(events[start-1].Event, false)
		size := eventSize(candidate)
		if pageBytes+size > maxTraceItemsBytes {
			break
		}
		events[start-1].Event = candidate
		pageBytes += size
		start--
	}
	page := TracePage{Truncated: start > 0 && pageBytes == 0}
	emittedBytes := 0
	for _, parsed := range events[start:] {
		ev, clipped := clipEvent(parsed.Event, false)
		ev, clipped = clipEventToLimit(ev, maxTraceItemsBytes-emittedBytes, clipped)
		if eventSize(ev) > maxTraceItemsBytes-emittedBytes {
			return TracePage{}, ErrUnavailable
		}
		emittedBytes += eventSize(ev)
		page.Truncated = page.Truncated || clipped
		if ev.Type != "tool" {
			page.SummaryTruncated = page.SummaryTruncated || clipped
		}
		if ev.Type == "tool" {
			ev.DetailRef = encodePiDetail(ref, s, s.branch[parsed.lineStart].ID, parsed.sourceOrdinal, parsed.call, parsed.Name, piToolStatic(parsed), traceDetailRevision(parsed.Event))
		}
		page.Items = append(page.Items, ev)
	}
	if start > 0 {
		next := encodePiCursor(ref, s, s.branch[events[start].lineStart].ID, events[start].sourceOrdinal)
		page.NextCursor = &next
	}
	return page, nil
}

func piToolStatic(event parsedEvent) string {
	sum := sha256.Sum256([]byte(event.call + "\x00" + event.Name + "\x00" + event.Input))
	return base64.RawURLEncoding.EncodeToString(sum[:12])
}

type piDetailLocator struct {
	Version     int    `json:"v"`
	Ref         string `json:"r"`
	Session     string `json:"s"`
	Incarnation string `json:"i"`
	Entry       string `json:"e"`
	Ordinal     int    `json:"o"`
	Call        string `json:"c"`
	Name        string `json:"n"`
	Static      string `json:"h"`
	Revision    string `json:"x"`
}

func encodePiDetail(ref Ref, session *piSession, entry string, ordinal int, call, name, static, revision string) string {
	raw, _ := json.Marshal(piDetailLocator{Version: 1, Ref: refFingerprint(ref), Session: session.id, Incarnation: session.incarnation, Entry: entry, Ordinal: ordinal, Call: call, Name: name, Static: static, Revision: revision})
	return base64.RawURLEncoding.EncodeToString(raw)
}
func (r *Reader) readPiTraceDetail(ref Ref, detail string) (TraceDetail, error) {
	if detail == "" || len(detail) > 2048 {
		return TraceDetail{}, ErrCursorInvalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(detail)
	if err != nil {
		return TraceDetail{}, ErrCursorInvalid
	}
	var locator piDetailLocator
	if json.Unmarshal(raw, &locator) != nil || locator.Version != 1 || locator.Ref != refFingerprint(ref) || locator.Entry == "" || locator.Ordinal < 0 || locator.Ordinal > 1024 {
		return TraceDetail{}, ErrCursorConflict
	}
	s, err := r.loadPiSession(ref, true)
	if err != nil {
		return TraceDetail{}, err
	}
	if locator.Session != s.id || locator.Incarnation != s.incarnation || !s.branchSet[locator.Entry] {
		return TraceDetail{}, ErrCursorConflict
	}
	for _, ev := range piEvents(s, false) {
		if ev.call == locator.Call && ev.Name == locator.Name && ev.sourceOrdinal == locator.Ordinal && piToolStatic(ev) == locator.Static && s.branch[ev.lineStart].ID == locator.Entry {
			item, truncated := clipEvent(ev.Event, false)
			return TraceDetail{DetailRef: detail, Text: item.Text, Input: item.Input, Output: item.Output, Truncated: truncated}, nil
		}
	}
	return TraceDetail{}, ErrCursorConflict
}
