package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"

	"pairfob/internal/envelope"
	"pairfob/internal/mux"
)

var testPace = answerPace{settle: 30 * time.Millisecond, local: 200 * time.Millisecond}

func answerAfter(t *testing.T, ctx context.Context, gathered, reflexive chan struct{}, hasCandidate func() bool) (time.Duration, error) {
	t.Helper()
	started := time.Now()
	err := awaitAnswerCandidates(ctx, gathered, reflexive, hasCandidate, testPace)
	return time.Since(started), err
}

func TestAnswerSettlesShortlyAfterTheFirstReflexiveCandidate(t *testing.T) {
	gathered, reflexive := make(chan struct{}), make(chan struct{})
	time.AfterFunc(20*time.Millisecond, func() { close(reflexive) })
	// A lost STUN reply on another interface keeps gathering open far longer.
	elapsed, err := answerAfter(t, context.Background(), gathered, reflexive, func() bool { return true })
	if err != nil {
		t.Fatal(err)
	}
	if elapsed < 50*time.Millisecond || elapsed >= testPace.local {
		t.Fatalf("answered after %v, want the settle time after the reflexive candidate", elapsed)
	}
}

func TestAnswerWithCompleteGatheringDoesNotWait(t *testing.T) {
	gathered, reflexive := make(chan struct{}), make(chan struct{})
	close(gathered)
	elapsed, err := answerAfter(t, context.Background(), gathered, reflexive, func() bool { return true })
	if err != nil || elapsed >= testPace.settle {
		t.Fatalf("answered after %v (%v), want at once", elapsed, err)
	}
}

func TestAnswerWithHostCandidatesAloneWaitsForTheLocalDeadline(t *testing.T) {
	gathered, reflexive := make(chan struct{}), make(chan struct{})
	elapsed, err := answerAfter(t, context.Background(), gathered, reflexive, func() bool { return true })
	if err != nil {
		t.Fatal(err)
	}
	if elapsed < testPace.local || elapsed >= testPace.local+100*time.Millisecond {
		t.Fatalf("answered after %v, want the local deadline %v", elapsed, testPace.local)
	}
}

func TestAnswerWithoutAnyCandidateWaitsForGathering(t *testing.T) {
	gathered, reflexive := make(chan struct{}), make(chan struct{})
	time.AfterFunc(testPace.local+100*time.Millisecond, func() { close(gathered) })
	elapsed, err := answerAfter(t, context.Background(), gathered, reflexive, func() bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	if elapsed < testPace.local+100*time.Millisecond {
		t.Fatalf("answered after %v with no candidate to offer", elapsed)
	}
}

func TestAnswerStopsWithItsContext(t *testing.T) {
	gathered, reflexive := make(chan struct{}), make(chan struct{})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := answerAfter(t, ctx, gathered, reflexive, func() bool { return false })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want the context deadline", err)
	}
}

func TestProductAnswerPaceOutlastsTheSTUNTimeout(t *testing.T) {
	if p2pAnswerPace.settle >= p2pAnswerPace.local {
		t.Fatalf("pace %+v must settle before the local deadline", p2pAnswerPace)
	}
	// Pion keeps a STUN binding open for five seconds before it gives up on the
	// reply. An answer sent before that carries host candidates alone, and a
	// peer behind NAT or on another network cannot reach those.
	if p2pAnswerPace.local < 5*time.Second {
		t.Fatalf("pace %+v answers before pion's STUN wait ends", p2pAnswerPace)
	}
	if p2pAnswerPace.local > 9*time.Second {
		t.Fatalf("pace %+v does not fit the offer budget", p2pAnswerPace)
	}
}

func TestAnswerWaitsForALateReflexiveCandidate(t *testing.T) {
	pace := answerPace{settle: 30 * time.Millisecond, local: 600 * time.Millisecond}
	gathered, reflexive := make(chan struct{}), make(chan struct{})
	time.AfterFunc(400*time.Millisecond, func() { close(reflexive) })
	started := time.Now()
	if err := awaitAnswerCandidates(context.Background(), gathered, reflexive, func() bool { return true }, pace); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed < 400*time.Millisecond || elapsed > 550*time.Millisecond {
		t.Fatalf("answered after %v, want the 400ms reflexive candidate plus the settle time", elapsed)
	}
}

func TestWebRTCAcceptorAnswersWhenSTUNStaysSilent(t *testing.T) {
	saved := p2pAnswerPace
	p2pAnswerPace = answerPace{settle: 30 * time.Millisecond, local: 300 * time.Millisecond}
	defer func() { p2pAnswerPace = saved }()
	caller, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer caller.Close()
	protocol := p2pDataChannelProtocol
	channel, err := caller.CreateDataChannel(p2pDataChannelLabel, &webrtc.DataChannelInit{Ordered: boolPointer(true), Protocol: &protocol})
	if err != nil {
		t.Fatal(err)
	}
	opened := make(chan struct{})
	channel.OnOpen(func() { close(opened) })
	offer, err := caller.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	callerGathered := webrtc.GatheringCompletePromise(caller)
	if err := caller.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	<-callerGathered

	// A documentation address: its STUN binding is never answered, so the answer
	// can only carry the host candidates gathered immediately.
	acceptor := &webRTCAcceptor{configuration: webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{{URLs: []string{"stun:192.0.2.1:3478"}}},
	}}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	started := time.Now()
	answer, link, err := acceptor.Accept(ctx, caller.LocalDescription().SDP, func(mux.Conn, envelope.Frame) {}, func(mux.Conn) {})
	if err != nil {
		t.Fatal(err)
	}
	defer link.Close()
	if elapsed := time.Since(started); elapsed >= 2*time.Second {
		t.Fatalf("answered after %v, want the local deadline", elapsed)
	}
	if !sdpCandidate.MatchString(answer) {
		t.Fatalf("answer carries no candidate:\n%s", answer)
	}
	if err := caller.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answer}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-opened:
	case <-ctx.Done():
		t.Fatal("data channel did not open on the early answer")
	}
}
