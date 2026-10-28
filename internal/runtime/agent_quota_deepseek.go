package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// DeepSeek bills a prepaid balance, not a subscription window. The read is the
// public balance endpoint the API key already can use; no model turn or
// credential write happens.
const deepSeekBalanceURL = "https://api.deepseek.com/user/balance"

// deepSeekQuotaKey finds the key to ask with. The variable wins for a daemon
// started from a shell; the file is for the installed service, which does not
// inherit credentials. A key that is present but unusable is not a login.
func deepSeekQuotaKey() (string, string) {
	if key := strings.TrimSpace(os.Getenv("DEEPSEEK_API_KEY")); key != "" {
		if validDeepSeekKey(key) {
			return key, ""
		}
		return "", "not_logged_in"
	}
	path, err := deepSeekQuotaKeyPath()
	if err != nil {
		return "", "not_logged_in"
	}
	raw, err := quotaFile(path, 16384)
	if os.IsNotExist(err) {
		return "", "not_logged_in"
	}
	if err != nil {
		return "", "auth_required"
	}
	key := strings.TrimSpace(string(raw))
	if !validDeepSeekKey(key) {
		return "", "not_logged_in"
	}
	return key, ""
}

func deepSeekQuotaKeyPath() (string, error) {
	dir := os.Getenv("PAIRFOB_STATE_DIR")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		dir = filepath.Join(home, ".config", "pairfob")
	}
	return filepath.Join(dir, "deepseek.key"), nil
}

func validDeepSeekKey(key string) bool {
	if len(key) < 8 || len(key) > 4096 {
		return false
	}
	for _, r := range key {
		if r < 0x21 || r > 0x7e {
			return false
		}
	}
	return true
}

func locateDeepSeekQuota(context.Context) (quotaAccountRead, AgentQuota) {
	key, status := deepSeekQuotaKey()
	if status != "" {
		return nil, emptyQuota("deepseek", "api", status)
	}
	return func(ctx context.Context) QuotaAccount {
		return fetchDeepSeekQuota(ctx, quotaHTTPClient(), key, time.Now())
	}, AgentQuota{}
}

func fetchDeepSeekQuota(ctx context.Context, c *http.Client, key string, now time.Time) QuotaAccount {
	var raw json.RawMessage
	status := quotaJSON(ctx, c, deepSeekBalanceURL, map[string]string{"Authorization": "Bearer " + key}, nil, &raw)
	if status != "" {
		return quotaAccount(emptyQuota("deepseek", "api", status))
	}
	return parseDeepSeekQuota(raw, now)
}

// parseDeepSeekQuota keeps the balance the account can spend. is_available is
// required so a placeholder is not read as a zero balance; its false value is
// still a real balance, and never a reason to invent usage.
func parseDeepSeekQuota(raw []byte, now time.Time) QuotaAccount {
	var payload struct {
		Available *bool `json:"is_available"`
		Balances  []struct {
			Currency string `json:"currency"`
			Total    string `json:"total_balance"`
		} `json:"balance_infos"`
	}
	if json.Unmarshal(raw, &payload) != nil || payload.Available == nil || len(payload.Balances) == 0 || len(payload.Balances) > 8 {
		return quotaAccount(emptyQuota("deepseek", "api", "unavailable"))
	}
	a := QuotaAccount{ID: "deepseek", Provider: "deepseek", Source: "api", State: "ok", ObservedAt: now.Unix(), Meters: []QuotaMeter{}}
	seen := map[string]bool{}
	for _, balance := range payload.Balances {
		unit := deepSeekUnit(balance.Currency)
		amount, ok := deepSeekAmount(balance.Total)
		if unit == "" || !ok || seen[unit] {
			continue
		}
		seen[unit] = true
		a.Meters = append(a.Meters, QuotaMeter{
			Kind: "balance", Name: "balance", Pool: unit, Headline: len(a.Meters) == 0,
			Amount: &amount, Scale: 2, Unit: unit,
		})
	}
	if len(a.Meters) == 0 {
		return quotaAccount(emptyQuota("deepseek", "api", "unavailable"))
	}
	return finishQuotaAccount(a)
}

// deepSeekUnit maps the provider's currency to a wire unit. An amount in a
// currency this build cannot name is left out rather than shown as another.
func deepSeekUnit(currency string) string {
	switch strings.ToUpper(strings.TrimSpace(currency)) {
	case "CNY":
		return "cny"
	case "USD":
		return "usd"
	}
	return ""
}

// deepSeekAmount reads the provider's decimal money string into cents (scale 2).
// It accepts whole amounts and one or two decimal places, never a third.
func deepSeekAmount(raw string) (int64, bool) {
	whole, fraction, point := strings.Cut(strings.TrimSpace(raw), ".")
	if whole == "" || len(whole) > 13 || len(fraction) > 2 || (point && fraction == "") {
		return 0, false
	}
	for _, r := range whole {
		if r < '0' || r > '9' {
			return 0, false
		}
	}
	for _, r := range fraction {
		if r < '0' || r > '9' {
			return 0, false
		}
	}
	units, err := strconv.ParseInt(whole, 10, 64)
	if err != nil || units > quotaMaxCount/100 {
		return 0, false
	}
	cents := int64(0)
	if fraction != "" {
		cents, _ = strconv.ParseInt(fraction, 10, 64)
		if len(fraction) == 1 {
			cents *= 10
		}
	}
	return units*100 + cents, true
}
