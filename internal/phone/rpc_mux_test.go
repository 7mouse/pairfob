package phone

import (
	"encoding/json"
	"strings"
	"testing"

	"pairfob/internal/crypto/aead"
	"pairfob/internal/envelope"
)

func TestMuxResponseDispatch(t *testing.T) {
	large := `{"bytes":"` + strings.Repeat("A", 90_000) + `","eof":false}`
	for _, tc := range []struct {
		name, body, result, failure string
		event                       bool
	}{
		{"media", `{"id":"req","ok":true,"result":` + large + `}`, large, "", false},
		{"error", `{"id":"req","ok":false,"error":{"code":"conflict"}}`, "", "conflict", false},
		{"missing-error", `{"id":"req","ok":false}`, "", "rpc failed", false},
		{"frame-event", `{"op":"TerminalFrame","data":"hello"}`, "", "", true},
		{"close-event", `{"op":"TerminalClosed","reason":"done"}`, "", "", true},
		{"event-with-id-is-reply", `{"id":"req","op":"TerminalFrame","ok":true,"result":null}`, "null", "", false},
		{"missing-id", `{"ok":true,"result":{}}`, "", "invalid RPC response", false},
		{"unknown-event", `{"op":"Unknown"}`, "", "invalid RPC response", false},
		{"malformed", `{"id":"req",`, "", "invalid RPC response", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			key := make([]byte, 32)
			wait := make(chan rpcOutcome, 1)
			client := &Client{routeID: [16]byte{1}, s2c: &aead.Direction{Key: key, Dir: aead.DirServer}, muxPending: map[string]chan rpcOutcome{"req": wait}}
			payload, err := aead.Seal(&aead.Direction{Key: key, Dir: aead.DirServer}, client.routeID, []byte(tc.body))
			if err != nil {
				t.Fatal(err)
			}
			client.dispatchMux(envelope.Frame{Version: 1, Typ: envelope.TypFWD, RouteID: client.routeID, Payload: payload})
			if tc.event {
				if len(client.Events) != 1 || string(client.Events[0]) != tc.body || len(client.muxPending) != 1 {
					t.Fatal("terminal event changed the pending RPC or its bytes")
				}
				select {
				case <-wait:
					t.Fatal("terminal event completed an unrelated request")
				default:
				}
				return
			}
			select {
			case got := <-wait:
				failure := ""
				if got.err != nil {
					failure = got.err.Error()
				}
				if failure != tc.failure || string(got.raw) != tc.result {
					t.Fatalf("result length=%d error=%q; expected length=%d error=%q", len(got.raw), failure, len(tc.result), tc.failure)
				}
				if len(got.raw) > 0 && !json.Valid(got.raw) {
					t.Fatal("invalid result JSON")
				}
			default:
				t.Fatal("RPC did not settle")
			}
			if len(client.muxPending) != 0 {
				t.Fatal("settled RPC was retained")
			}
		})
	}
}
