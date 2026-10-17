package main

import (
	"context"

	"github.com/pion/webrtc/v4"
)

// countLocalICECandidates reports how many ICE candidates this host gathers
// without a STUN server. A host candidate only needs the interface table, and
// that is what a binary built for the wrong platform, or a sandbox that hides
// the interfaces, cannot read. Pion then refuses to create a PeerConnection and
// every direct attempt ends as `p2p_offer_failed`, while the relay keeps
// working and the phone reports a strict NAT that is not there.
func countLocalICECandidates(ctx context.Context) (int, error) {
	peer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return 0, err
	}
	defer func() { _ = peer.Close() }()
	protocol := p2pDataChannelProtocol
	if _, err := peer.CreateDataChannel(p2pDataChannelLabel, &webrtc.DataChannelInit{Protocol: &protocol}); err != nil {
		return 0, err
	}
	offer, err := peer.CreateOffer(nil)
	if err != nil {
		return 0, err
	}
	gathered := webrtc.GatheringCompletePromise(peer)
	if err := peer.SetLocalDescription(offer); err != nil {
		return 0, err
	}
	select {
	case <-gathered:
	case <-ctx.Done():
	}
	local := peer.LocalDescription()
	if local == nil {
		return 0, nil
	}
	return len(sdpCandidate.FindAllString(local.SDP, -1)), nil
}

// probeICEGathering returns the local candidate count and, when the host cannot
// produce one, the sentence to print. Addresses never leave this function.
func probeICEGathering(ctx context.Context) (int, string) {
	count, err := countLocalICECandidates(ctx)
	if err != nil {
		return 0, doctorGatherNote(err)
	}
	if count == 0 {
		return 0, doctorNoGatherNote
	}
	return count, ""
}
