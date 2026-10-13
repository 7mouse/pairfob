package main

import (
	"bytes"
	"strings"
	"testing"

	"pairfob/internal/runtime"
)

func TestQuotaListPrintsStatesAndSharesOnly(t *testing.T) {
	used, low, amount := 28.0, 94.0, int64(1240)
	var out bytes.Buffer
	printQuotaAccounts(&out, []runtime.QuotaReading{
		{Account: runtime.QuotaAccount{ID: "codex", Provider: "codex", Plan: "pro", State: "ok", Meters: []runtime.QuotaMeter{
			{Kind: "quota", Name: "codex", Pool: "plan", Headline: true, UsedPercent: &used, WindowMinutes: 300},
			{Kind: "quota", Name: "codex", Pool: "plan", Headline: true, UsedPercent: &low, WindowMinutes: 10080},
			{Kind: "quota", Name: "Other Model", Pool: "other-model", UsedPercent: &used, WindowMinutes: 300},
		}}},
		{Account: runtime.QuotaAccount{ID: "copilot", Provider: "copilot", State: "ok", Meters: []runtime.QuotaMeter{
			{Kind: "unlimited", Name: "premium interactions", Pool: "premium-interactions", Headline: true},
			{Kind: "balance", Name: "top up", Pool: "top-up", Headline: true, Amount: &amount, Scale: 2, Unit: "usd"},
		}}},
		{Account: runtime.QuotaAccount{ID: "grok", Provider: "grok", State: "needs_action", Reason: "relogin"}},
		{Account: runtime.QuotaAccount{ID: "antigravity", Provider: "antigravity", State: "not_configured", Reason: "not_running"}},
	})
	got := out.String()
	for _, want := range []string{
		"codex        ok              pro  5h 72% left · 7d 6% left · 1 more",
		"copilot      ok              -    premium interactions unlimited · top up 12.40 usd",
		"grok         needs action    -    sign in again on this computer",
		"antigravity  not configured  -    app not running",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in\n%s", want, got)
		}
	}
	for amount, want := range map[int64]string{0: "0.00", 5: "0.05", 1240: "12.40"} {
		if got := quotaAmountText(amount, 2); got != want {
			t.Fatalf("%d: %s", amount, got)
		}
	}
	if err := quotaCLI([]string{"key", "factory"}, &out); err == nil || !strings.Contains(err.Error(), "usage: pairfob quota list") {
		t.Fatalf("unknown subcommand: %v", err)
	}
}
