package runtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAntigravityLoginIsFoundByNameAndJudgedByExpiry(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	fresh := now.Add(40 * time.Minute).Format(time.RFC3339)
	old := now.Add(-time.Minute).Format(time.RFC3339)
	wrapped := "go-keyring-base64:" + base64.StdEncoding.EncodeToString([]byte(`{"access_token":"tok","expiry":"`+fresh+`"}`))
	for name, c := range map[string]struct{ raw, token, status string }{
		"flat":           {`{"access_token":"tok","refresh_token":"r","expiry":"` + fresh + `"}`, "tok", ""},
		"camel case":     {`{"accessToken":"tok","expiresAt":` + jsonNumber(now.Add(time.Hour).UnixMilli()) + `}`, "tok", ""},
		"one level down": {`{"email":"a@b.c","token":{"access_token":"tok","expiry":"` + fresh + `"}}`, "tok", ""},
		"JSON in a text": {`{"token":"{\"access_token\":\"tok\",\"expiry\":\"` + fresh + `\"}"}`, "tok", ""},
		"wrapped":        {wrapped, "tok", ""},
		"no expiry":      {`{"access_token":"tok"}`, "tok", ""},
		"expired":        {`{"access_token":"tok","expiry":"` + old + `"}`, "", "auth_required"},
		"about to":       {`{"access_token":"tok","expiry":` + jsonNumber(now.Add(30*time.Second).Unix()) + `}`, "", "auth_required"},
		"no token":       {`{"refresh_token":"r"}`, "", "unavailable"},
		"not JSON":       {`ya29.something`, "", "unavailable"},
		"bad wrapping":   {`go-keyring-base64:%%%`, "", "unavailable"},
		"oversized":      {`{"access_token":"` + strings.Repeat("x", 16385) + `"}`, "", "unavailable"},
	} {
		token, status := parseAntigravityLogin([]byte(c.raw), now)
		if token != c.token || status != c.status {
			t.Errorf("%s: token %q status %q", name, token, status)
		}
	}
}

func jsonNumber(n int64) string {
	raw, _ := json.Marshal(n)
	return string(raw)
}

func TestAntigravityCloudQuotaAsksForTheTierThenTheSummary(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	reset := now.Add(3 * time.Hour).UTC().Format(time.RFC3339)
	var asked []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		asked = append(asked, r.URL.Path+" "+string(body))
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("request: %s %q", r.Method, r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/v1internal:loadCodeAssist":
			_, _ = w.Write([]byte(`{"cloudaicompanionProject":"proj-1","currentTier":{"name":"Free"},"paidTier":{"name":"Google AI Pro"}}`))
		case "/v1internal:retrieveUserQuotaSummary":
			_, _ = w.Write([]byte(`{"groups":[{"displayName":"Gemini","buckets":[{"bucketId":"pro","displayName":"Pro","remainingFraction":0.25,"resetTime":"` + reset + `"}]}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	q := fetchAntigravityCloudQuota(context.Background(), server.Client(), server.URL+"/v1internal:", "tok", now)
	if q.Status != "ok" || q.Source != "oauth" || q.Plan != "Google AI Pro" || len(q.Windows) != 1 {
		t.Fatalf("quota: %+v", q)
	}
	if w := q.Windows[0]; w.Name != "Gemini / Pro" || w.UsedPercent != 75 || w.ResetsAt != now.Add(3*time.Hour).Unix() {
		t.Fatalf("window: %+v", w)
	}
	if len(asked) != 2 || !strings.Contains(asked[0], `"pluginType":"GEMINI"`) || asked[1] != `/v1internal:retrieveUserQuotaSummary {"project":"proj-1"}` {
		t.Fatalf("asked: %q", asked)
	}
}

func TestAntigravityCloudQuotaTellsAnExpiredLoginFromARefusal(t *testing.T) {
	for code, want := range map[int]string{401: "auth_required", 403: "unavailable", 429: "throttled", 500: "unavailable"} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(code) }))
		ctx := context.WithValue(context.Background(), quotaNoteKey{}, &quotaNote{})
		q := fetchAntigravityCloudQuota(ctx, server.Client(), server.URL+"/v1internal:", "tok", time.Now())
		server.Close()
		if q.Status != want || q.Source != "oauth" || len(q.Windows) != 0 {
			t.Errorf("HTTP %d: %+v", code, q)
		}
	}
	// A summary with no numbers in it is not an empty allowance.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{}`)) }))
	defer server.Close()
	if q := fetchAntigravityCloudQuota(context.Background(), server.Client(), server.URL+"/v1internal:", "tok", time.Now()); q.Status != "unavailable" {
		t.Fatalf("empty summary: %+v", q)
	}
}
