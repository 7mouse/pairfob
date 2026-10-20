package main

import (
	"context"
	"regexp"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
)

// An answer does not wait for ICE gathering to complete: pion keeps a STUN
// binding open for five seconds before it gives up on a lost reply, while the
// reply from the other interfaces arrives within a fraction of a second.
// Candidates are not trickled afterwards, so an answer sent without the
// server-reflexive candidate is only reachable from the computer's own networks.
//
// The trade is deliberate and only shows up where STUN stays silent: a host with
// server-reflexive candidates answers `settle` after the first one as before,
// while a host without any answers at the hard stop instead of immediately. The
// alternative — shipping host candidates early — cannot be fixed up later,
// because the peer never learns the address this computer is reachable at.
type answerPace struct {
	// After the first server-reflexive candidate, for the other interfaces' replies.
	settle time.Duration
	// Hard stop once STUN stayed silent that long; answer with the host
	// candidates instead of waiting for the context.
	local time.Duration
}

var p2pAnswerPace = answerPace{settle: 300 * time.Millisecond, local: 6 * time.Second}

var sdpCandidate = regexp.MustCompile(`(?m)^a=candidate:`)

// gatheringSignals must run before SetLocalDescription, which starts gathering.
// It owns the peer's OnICECandidate handler.
func gatheringSignals(peer *webrtc.PeerConnection) (gathered <-chan struct{}, reflexive <-chan struct{}) {
	found := make(chan struct{})
	var once sync.Once
	peer.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate != nil && candidate.Typ == webrtc.ICECandidateTypeSrflx {
			once.Do(func() { close(found) })
		}
	})
	return webrtc.GatheringCompletePromise(peer), found
}

func hasLocalCandidate(peer *webrtc.PeerConnection) bool {
	local := peer.LocalDescription()
	return local != nil && sdpCandidate.MatchString(local.SDP)
}

// awaitAnswerCandidates returns once the local description carries enough
// candidates to answer with: gathering completed, `settle` after the first
// server-reflexive candidate, or once `local` passed with any candidate.
func awaitAnswerCandidates(
	ctx context.Context,
	gathered, reflexive <-chan struct{},
	hasCandidate func() bool,
	pace answerPace,
) error {
	local := time.NewTimer(pace.local)
	defer local.Stop()
	var settled <-chan time.Time
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-gathered:
			return nil
		case <-reflexive:
			reflexive = nil
			settled = time.After(pace.settle)
		case <-settled:
			return nil
		case <-local.C:
			if hasCandidate() {
				return nil
			}
		}
	}
}
