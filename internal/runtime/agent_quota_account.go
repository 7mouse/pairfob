package runtime

import (
	"math"
	"regexp"
	"time"
)

// QuotaAccount is one subscription account as AgentQuotaV2 reports it. A
// provider may have several; ID tells them apart and is all the phone keys on.
// Meters is a previous sample when State is failed or throttled, and empty for
// needs_action and not_configured: numbers of a login that no longer reads may
// belong to another account.
type QuotaAccount struct {
	ID         string       `json:"id"`
	Provider   string       `json:"provider"`
	Plan       string       `json:"plan"`
	Scope      string       `json:"scope,omitempty"`
	Region     string       `json:"region,omitempty"`
	Label      string       `json:"label,omitempty"`
	Source     string       `json:"source,omitempty"`
	State      string       `json:"state"`
	Reason     string       `json:"reason,omitempty"`
	ObservedAt int64        `json:"observed_at"`
	RetryAt    int64        `json:"retry_at,omitempty"`
	Meters     []QuotaMeter `json:"meters"`
}

// QuotaMeter is one allowance of an account. Kind decides which fields it
// carries: a quota has a used share, a balance an amount with no ceiling, a
// level only the provider's coarse word, and unlimited and unread nothing.
// Meters of one Pool limit the same usage; meters of different pools are never
// compared or added. Headline marks the meters that stand for the account.
type QuotaMeter struct {
	Kind          string   `json:"kind"`
	Name          string   `json:"name"`
	Pool          string   `json:"pool"`
	Headline      bool     `json:"headline,omitempty"`
	UsedPercent   *float64 `json:"used_percent,omitempty"`
	Used          *int64   `json:"used,omitempty"`
	Limit         *int64   `json:"limit,omitempty"`
	Amount        *int64   `json:"amount,omitempty"`
	Scale         int      `json:"scale,omitempty"`
	Unit          string   `json:"unit,omitempty"`
	Level         string   `json:"level,omitempty"`
	WindowMinutes int64    `json:"window_minutes,omitempty"`
	ResetsAt      int64    `json:"resets_at,omitempty"`
}

// QuotaReading is what one read of one account produced: the account, and for
// the six providers the first AgentQuota operation knew, the item that
// operation still returns.
type QuotaReading struct {
	Account QuotaAccount
	Legacy  *AgentQuota
}

const (
	quotaSampleMaxAge = 15 * time.Minute
	quotaMaxMeters    = 32
	quotaMaxCount     = int64(1) << 53
	quotaMaxTime      = int64(4102444800)
)

var (
	quotaToken = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	quotaUnits = map[string]bool{"usd": true, "cny": true, "credits": true, "requests": true, "hours": true}
	quotaLevel = map[string]bool{"full": true, "high": true, "medium": true, "low": true, "empty": true}
)

func validQuotaMeter(m QuotaMeter) bool {
	if m.Name == "" || len(m.Name) > 160 || !quotaToken.MatchString(m.Pool) || m.Scale < 0 || m.Scale > 6 ||
		m.WindowMinutes < 0 || m.WindowMinutes > 525600 || m.ResetsAt < 0 || m.ResetsAt > quotaMaxTime {
		return false
	}
	count := func(v *int64) bool { return v != nil && *v >= 0 && *v <= quotaMaxCount }
	bare := m.Used == nil && m.Limit == nil && m.Amount == nil && m.Scale == 0 && m.Unit == ""
	switch m.Kind {
	case "quota":
		if m.UsedPercent == nil || math.IsNaN(*m.UsedPercent) || *m.UsedPercent < 0 || *m.UsedPercent > 100 || m.Level != "" || m.Amount != nil {
			return false
		}
		// The share stands on its own; the counts behind it come whole or not at all.
		return bare || (count(m.Used) && count(m.Limit) && *m.Limit > 0 && quotaUnits[m.Unit])
	case "balance":
		return count(m.Amount) && quotaUnits[m.Unit] && m.UsedPercent == nil && m.Used == nil && m.Limit == nil && m.Level == "" && m.WindowMinutes == 0
	case "level":
		return quotaLevel[m.Level] && m.UsedPercent == nil && bare
	case "unlimited":
		return m.UsedPercent == nil && m.Level == "" && bare
	case "unread":
		return m.UsedPercent == nil && m.Level == "" && bare && !m.Headline && m.WindowMinutes == 0 && m.ResetsAt == 0
	}
	return false
}

// A reader's status names why it has no number. The first AgentQuota operation
// publishes nine of them; the rest are finer causes it reports as the nearest
// of the nine, so an older phone still decodes every item.
var quotaStatuses = map[string]struct{ legacy, state, reason string }{
	"ok":              {"ok", "ok", ""},
	"stale":           {"stale", "ok", ""},
	"unavailable":     {"unavailable", "failed", "unavailable"},
	"timeout":         {"unavailable", "failed", "timeout"},
	"throttled":       {"unavailable", "throttled", ""},
	"auth_required":   {"auth_required", "needs_action", "relogin"},
	"keychain_denied": {"auth_required", "needs_action", "allow_keychain"},
	"ambiguous":       {"auth_required", "needs_action", "choose_account"},
	"setup_required":  {"setup_required", "needs_action", "setup"},
	"not_installed":   {"not_installed", "not_configured", "not_installed"},
	"not_logged_in":   {"not_logged_in", "not_configured", "no_login"},
	"not_running":     {"not_running", "not_configured", "not_running"},
	"unsupported":     {"unsupported", "not_configured", "unsupported_login"},
}

// legacyQuota is the item the first AgentQuota operation returns for a read.
func legacyQuota(q AgentQuota) AgentQuota {
	status, ok := quotaStatuses[q.Status]
	if !ok {
		return emptyQuota(q.Provider, q.Source, "unavailable")
	}
	q.Status = status.legacy
	if q.Windows == nil {
		q.Windows = []QuotaWindow{}
	}
	return q
}

// quotaAccount is the same read as AgentQuotaV2 reports it. A read with one
// account per provider uses the provider as the account's ID.
func quotaAccount(q AgentQuota) QuotaAccount {
	a := QuotaAccount{ID: q.Provider, Provider: q.Provider, Plan: q.Plan, Source: q.Source, Meters: []QuotaMeter{}}
	status, ok := quotaStatuses[q.Status]
	if !ok {
		a.State, a.Reason = "failed", "unavailable"
		return a
	}
	a.State, a.Reason = status.state, status.reason
	if a.State != "ok" {
		return a
	}
	for _, w := range q.Windows {
		m := QuotaMeter{Kind: "quota", Name: w.Name, Pool: w.pool, Headline: w.headline, WindowMinutes: w.WindowMinutes, ResetsAt: w.ResetsAt}
		if m.Pool == "" {
			m.Pool = "plan"
		}
		if w.Unlimited {
			m.Kind = "unlimited"
		} else {
			used := w.UsedPercent
			m.UsedPercent = &used
		}
		if !validQuotaMeter(m) {
			a.State, a.Reason, a.Meters = "failed", "unavailable", []QuotaMeter{}
			return a
		}
		a.Meters = append(a.Meters, m)
	}
	if len(a.Meters) == 0 || len(a.Meters) > quotaMaxMeters {
		a.State, a.Reason, a.Meters = "failed", "unavailable", []QuotaMeter{}
		return a
	}
	a.ObservedAt = q.ObservedAt
	return a
}

// QuotaAccountSampled reports whether the account carries numbers read just
// now, the only kind worth keeping for a later read that fails.
func QuotaAccountSampled(a QuotaAccount) bool {
	return (a.State == "ok" || a.State == "partial") && len(a.Meters) > 0 && a.ObservedAt > 0
}

// CarryQuotaSample gives a read that failed or was throttled the numbers of the
// last one that worked, under their own sample time, while they are recent
// enough to show. Every other state is returned as read.
func CarryQuotaSample(next QuotaAccount, previous *QuotaAccount, now time.Time) QuotaAccount {
	if (next.State != "failed" && next.State != "throttled") || previous == nil || !QuotaAccountSampled(*previous) {
		return next
	}
	age := now.Unix() - previous.ObservedAt
	if age < 0 || age >= int64(quotaSampleMaxAge/time.Second) {
		return next
	}
	next.ObservedAt = previous.ObservedAt
	next.Meters = append([]QuotaMeter(nil), previous.Meters...)
	if next.Plan == "" {
		next.Plan = previous.Plan
	}
	return next
}
