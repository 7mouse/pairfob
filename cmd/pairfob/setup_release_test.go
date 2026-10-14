package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func manifestFixture(version string) map[string]any {
	assets, hashes := map[string]string{}, map[string]string{}
	for _, p := range []string{"macos-aarch64", "macos-x86_64", "linux-aarch64", "linux-x86_64"} {
		assets[p] = "https://github.com/herdrdev/herdr/releases/download/v" + version + "/herdr-" + p
		hashes[p] = strings.Repeat("a", 64)
	}
	return map[string]any{"version": version, "assets": assets, "sha256": hashes, "releases": map[string]any{"0.1.0": "ignored"}}
}

func TestHerdrReleaseSelection(t *testing.T) {
	for _, p := range []struct{ os, arch, want string }{{"darwin", "arm64", "macos-aarch64"}, {"darwin", "amd64", "macos-x86_64"}, {"linux", "arm64", "linux-aarch64"}, {"linux", "amd64", "linux-x86_64"}} {
		b, _ := json.Marshal(manifestFixture("12.30.4"))
		got, err := parseHerdrRelease(b, p.os, p.arch)
		if err != nil || got.Version != "12.30.4" || got.Platform != p.want {
			t.Fatalf("%+v %v", got, err)
		}
	}
}

func TestHerdrManifestRejectsUnsafeOrIncompleteRelease(t *testing.T) {
	for _, mutation := range []string{"preview", "bad version", "missing hash", "bad hash", "missing asset", "other host", "other repo", "other version", "credentials", "query", "encoded", "port"} {
		t.Run(mutation, func(t *testing.T) {
			m := manifestFixture("1.2.3")
			a := m["assets"].(map[string]string)
			h := m["sha256"].(map[string]string)
			key := "linux-x86_64"
			switch mutation {
			case "preview":
				m["version"] = "1.2.3-rc1"
			case "bad version":
				m["version"] = "01.2.3"
			case "missing hash":
				delete(h, key)
			case "bad hash":
				h[key] = strings.Repeat("z", 64)
			case "missing asset":
				delete(a, key)
			case "other host":
				a[key] = strings.Replace(a[key], "github.com", "github.com.evil.test", 1)
			case "other repo":
				a[key] = strings.Replace(a[key], "herdrdev/herdr", "other/herdr", 1)
			case "other version":
				a[key] = strings.Replace(a[key], "v1.2.3", "v1.2.4", 1)
			case "credentials":
				a[key] = strings.Replace(a[key], "https://", "https://user@", 1)
			case "query":
				a[key] += "?token=bad"
			case "encoded":
				a[key] = strings.Replace(a[key], "herdrdev", "%68erdrdev", 1)
			case "port":
				a[key] = strings.Replace(a[key], "github.com", "github.com:443", 1)
			}
			b, _ := json.Marshal(m)
			if _, err := parseHerdrRelease(b, "linux", "amd64"); err == nil {
				t.Fatal("accepted unsafe release")
			}
		})
	}
	if _, err := parseHerdrRelease([]byte("{"), "linux", "amd64"); err == nil {
		t.Fatal("bad JSON")
	}
	b, _ := json.Marshal(manifestFixture("1.2.3"))
	if _, err := parseHerdrRelease(b, "windows", "amd64"); err == nil {
		t.Fatal("unsupported platform")
	}
}

func TestHerdrVersionOrder(t *testing.T) {
	for _, tc := range []struct {
		a, b string
		want int
	}{{"0.9.4", "0.10.0", -1}, {"10.0.0", "2.99.99", 1}, {"1.2.3", "1.2.3", 0}} {
		if got := compareHerdrVersions(tc.a, tc.b); got != tc.want {
			t.Fatalf("%+v: %d", tc, got)
		}
	}
}

func TestSetupArguments(t *testing.T) {
	for _, args := range [][]string{nil, {"--non-interactive"}, {"--install-herdr"}, {"--no-install-herdr"}, {"--update-herdr"}, {"--update-herdr", "--restart-herdr"}} {
		o, err := parseSetupOptions(args)
		if err != nil {
			t.Fatal(args, err)
		}
		if len(args) == 0 && !o.install {
			t.Fatal("default does not install")
		}
	}
	for _, args := range [][]string{{"--restart-herdr"}, {"--no-install-herdr", "--install-herdr"}, {"--install-herdr", "--no-install-herdr"}, {"--update-herdr", "--restart-herdr", "--non-interactive"}, {"--update-herdr", "--no-install-herdr"}, {"--unknown"}} {
		if _, err := parseSetupOptions(args); err == nil {
			t.Fatal("accepted", args)
		}
	}
}
