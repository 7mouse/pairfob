package daemon

import (
	"testing"

	"pairfob/internal/envelope"
	"pairfob/internal/mux"
	"pairfob/internal/runtime"
)

func TestRuntimeRPCFixtureClosesSessionAndPipes(t *testing.T) {
	var engine *Engine
	var session *sess
	var clientPipe mux.Conn
	t.Run("fixture", func(t *testing.T) {
		e, client := runtimeRPCClient(t, runtime.NewFake())
		engine, clientPipe = e, client.Conn
		engine.mu.Lock()
		defer engine.mu.Unlock()
		for _, s := range engine.sessions {
			session = s
		}
	})
	if session == nil {
		t.Fatal("fixture never established a session")
	}
	select {
	case <-session.rpcStop:
	default:
		t.Fatal("session workers were not stopped")
	}
	engine.mu.Lock()
	remaining := len(engine.sessions)
	engine.mu.Unlock()
	if remaining != 0 {
		t.Fatal("fixture retained its session")
	}
	for _, conn := range []mux.Conn{engine.Conn, clientPipe} {
		if err := conn.Send(envelope.Frame{}); err == nil {
			t.Fatal("fixture transport remained open")
		}
	}
}
