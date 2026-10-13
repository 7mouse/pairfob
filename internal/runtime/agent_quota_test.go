package runtime

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCodexQuotaBucketsAndInvalidLimits(t *testing.T) {
	now := time.Unix(1800000000, 0)
	raw := []byte(`{"rateLimits":{"primary":{"usedPercent":99,"windowDurationMins":300,"resetsAt":1800001000}},"rateLimitsByLimitId":{"codex":{"planType":"pro","primary":{"usedPercent":25,"windowDurationMins":300,"resetsAt":1800001000}},"review":{"secondary":{"usedPercent":0,"windowDurationMins":10080,"resetsAt":1800100000}}}}`)
	q := parseCodexQuota(raw, "", now)
	if q.Status != "ok" || q.Plan != "pro" || len(q.Windows) != 2 || q.Windows[0].UsedPercent != 25 || q.Windows[1].UsedPercent != 0 {
		t.Fatalf("%+v", q)
	}
	for _, replacement := range []string{`"usedPercent":null`, `"usedPercent":101`, `"usedPercent":-1`} {
		bad := strings.Replace(string(raw), `"usedPercent":25`, replacement, 1)
		if got := parseCodexQuota([]byte(bad), "", now); got.Status != "unavailable" || len(got.Windows) != 0 {
			t.Fatalf("accepted invalid limit: %+v", got)
		}
	}
	legacy := []byte(`{"rateLimits":{"primary":{"usedPercent":100,"windowDurationMins":300,"resetsAt":1800000000},"secondary":null}}`)
	if got := parseCodexQuota(legacy, "plus", now); got.Status != "stale" || len(got.Windows) != 1 {
		t.Fatalf("expired: %+v", got)
	}
	if got := parseCodexQuota([]byte(`{"rateLimits":null}`), "", now); got.Status != "unavailable" {
		t.Fatalf("missing: %+v", got)
	}
}

func TestClaudeQuotaAllowlistAndFreshness(t *testing.T) {
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	now := time.Unix(1800000000, 0)
	raw := []byte(`{"session_id":"secret","cwd":"/secret","rate_limits":{"five_hour":{"used_percentage":0,"resets_at":1800001000},"seven_day":{"used_percentage":50.5,"resets_at":1800100000}}}`)
	q, err := ParseClaudeQuota(raw, now)
	if err != nil || q.Status != "ok" || len(q.Windows) != 2 || q.Windows[0].UsedPercent != 0 {
		t.Fatalf("%+v %v", q, err)
	}
	data, _ := json.Marshal(q)
	if strings.Contains(string(data), "secret") {
		t.Fatal("statusline fields leaked")
	}
	path, _ := ClaudeQuotaPath()
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if got := readClaudeQuota(now); got.Status != "ok" {
		t.Fatalf("%+v", got)
	}
	if got := readClaudeQuota(now.Add(16 * time.Minute)); got.Status != "stale" {
		t.Fatalf("%+v", got)
	}
	q, err = ParseClaudeQuota([]byte(`{"rate_limits":{}}`), now)
	if err != nil || q.Status != "unavailable" || len(q.Windows) != 0 {
		t.Fatalf("missing: %+v %v", q, err)
	}
	q, err = ParseClaudeQuota([]byte(`{"rate_limits":{"five_hour":{"used_percentage":101,"resets_at":1800001000}}}`), now)
	if err != nil || len(q.Windows) != 0 {
		t.Fatalf("invalid: %+v %v", q, err)
	}
	if err = os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if got := readClaudeQuota(now); got.Status != "setup_required" {
		t.Fatalf("%+v", got)
	}
}

func TestCodexQuotaSubprocessReadAndTimeout(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	script := `#!/bin/sh
read init
printf '%s\n' '{"id":1,"result":{}}'
read initialized
read account
printf '%s\n' '{"id":2,"result":{"account":{"type":"chatgpt","planType":"pro"}}}'
read limits
printf '%s\n' '{"id":3,"result":{"rateLimits":{"primary":{"usedPercent":12,"windowDurationMins":300,"resetsAt":2100000000}}}}'
`
	if err := os.WriteFile(filepath.Join(dir, "codex"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	if q := locatedQuota(context.Background(), locateCodexQuota); q.Status != "ok" || q.Plan != "pro" || q.Windows[0].UsedPercent != 12 {
		t.Fatalf("%+v", q)
	}
	if err := os.WriteFile(filepath.Join(dir, "codex"), []byte("#!/bin/sh\nread init\nread forever\n"), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if q := locatedQuota(ctx, locateCodexQuota); q.Status != "timeout" {
		t.Fatalf("%+v", q)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("timeout did not stop account reader")
	}
}

func TestAgentQuotaLive(t *testing.T) {
	if os.Getenv("PAIRFOB_TEST_LIVE_QUOTA") != "1" {
		t.Skip("explicit local account read only")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 9*time.Second)
	defer cancel()
	for _, reading := range ReadQuotaAccounts(ctx) {
		account, _ := json.Marshal(reading.Account)
		legacy, _ := json.Marshal(reading.Legacy)
		t.Logf("%s\n  first wire: %s", account, legacy)
	}
}

// locatedQuota runs a provider's two steps the way one read does.
func locatedQuota(ctx context.Context, locate func(context.Context) (quotaRead, AgentQuota)) AgentQuota {
	read, q := locate(ctx)
	if read == nil {
		return q
	}
	return read(ctx)
}

func TestClaudeQuotaRejectsNonRegularCache(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	path, _ := ClaudeQuotaPath()
	if err := os.Symlink(filepath.Join(dir, "missing"), path); err != nil {
		t.Fatal(err)
	}
	if q := readClaudeQuota(time.Now()); q.Status != "unavailable" {
		t.Fatalf("accepted symlink: %+v", q)
	}
}
