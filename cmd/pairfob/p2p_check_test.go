package main

import (
	"context"
	"net"
	"testing"
	"time"
)

// hasNonLoopbackAddress keeps the gather check honest on hosts that only have a
// loopback interface, where pion rightly gathers nothing.
func hasNonLoopbackAddress(t *testing.T) bool {
	t.Helper()
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return false
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			return true
		}
	}
	return false
}

func TestCountLocalICECandidatesFindsThisHost(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	count, err := countLocalICECandidates(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if count == 0 && !hasNonLoopbackAddress(t) {
		t.Skip("no non-loopback interface on this host")
	}
	if count == 0 {
		t.Fatal("gathered no local candidate on a host that has an interface")
	}
}

func TestProbeICEGatheringReportsACountWithoutANote(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	count, note := probeICEGathering(ctx)
	if note != "" {
		t.Fatalf("note = %q", note)
	}
	if count == 0 && !hasNonLoopbackAddress(t) {
		t.Skip("no non-loopback interface on this host")
	}
	if count < 1 {
		t.Fatalf("count = %d", count)
	}
}
