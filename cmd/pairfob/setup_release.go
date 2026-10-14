package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

const herdrManifestURL = "https://herdr.dev/latest.json"

type herdrRelease struct {
	Version  string `json:"version"`
	URL      string `json:"url"`
	SHA256   string `json:"sha256"`
	Platform string `json:"platform"`
}

var stableHerdrRelease = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)

func parseHerdrRelease(payload []byte, goos, arch string) (herdrRelease, error) {
	platforms := map[string]string{"darwin/arm64": "macos-aarch64", "darwin/amd64": "macos-x86_64", "linux/arm64": "linux-aarch64", "linux/amd64": "linux-x86_64"}
	platform, ok := platforms[goos+"/"+arch]
	if !ok {
		return herdrRelease{}, fmt.Errorf("Herdr automatic install is unsupported on %s/%s", goos, arch)
	}
	var manifest struct {
		Version string            `json:"version"`
		Assets  map[string]string `json:"assets"`
		SHA256  map[string]string `json:"sha256"`
	}
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return herdrRelease{}, fmt.Errorf("invalid Herdr release manifest: %w", err)
	}
	r := herdrRelease{Version: manifest.Version, URL: manifest.Assets[platform], SHA256: strings.ToLower(manifest.SHA256[platform]), Platform: platform}
	if !stableHerdrRelease.MatchString(r.Version) {
		return r, errors.New("Herdr manifest does not name a stable release")
	}
	digest, err := hex.DecodeString(r.SHA256)
	if err != nil || len(digest) != 32 {
		return r, errors.New("Herdr manifest has no valid platform SHA-256")
	}
	want := "https://github.com/herdrdev/herdr/releases/download/v" + r.Version + "/herdr-" + platform
	if r.URL != want {
		return r, errors.New("Herdr manifest has an unexpected release asset URL")
	}
	return r, nil
}

func latestHerdrRelease(goos, arch string) (herdrRelease, error) {
	payload, err := fetchDownloadBytes(herdrManifestURL, 8<<20, downloadPolicy{
		timeout: updateMetadataTimeout, attempts: 2, retryDelay: updateRetryDelay,
		redirect: func(_ *http.Request, _ []*http.Request) error { return errors.New("Herdr manifest redirect refused") },
	})
	if err != nil {
		return herdrRelease{}, fmt.Errorf("read latest stable Herdr release: %w", err)
	}
	return parseHerdrRelease(payload, goos, arch)
}

var errHerdrDownloadRedirect = errors.New("Herdr download redirected outside the trusted release host")

func herdrDownloadRedirect(req *http.Request, via []*http.Request) error {
	if len(via) > 3 || req.URL.Scheme != "https" || req.URL.Host != "release-assets.githubusercontent.com" || req.URL.User != nil {
		return errHerdrDownloadRedirect
	}
	return nil
}

func fetchHerdrArtifact(rawURL string) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || !strings.HasPrefix(u.Path, "/herdrdev/herdr/releases/download/") {
		return nil, errors.New("untrusted Herdr download URL")
	}
	return fetchDownloadBytes(rawURL, maxUpdateBytes, downloadPolicy{
		timeout: updateArtifactTimeout, idleTimeout: updateArtifactIdleTimeout, attempts: 2,
		retryDelay: updateRetryDelay, progress: printDownloadProgress, redirect: herdrDownloadRedirect,
	})
}

func herdrBinaryVersion(binary string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, binary, "--version").Output()
	if err != nil {
		return "", fmt.Errorf("check Herdr executable: %w", err)
	}
	version := strings.TrimPrefix(strings.TrimSpace(string(out)), "herdr ")
	if !stableHerdrRelease.MatchString(version) {
		return "", fmt.Errorf("unrecognized stable Herdr version: %q", version)
	}
	return version, nil
}

func compareHerdrVersions(a, b string) int {
	for i, part := range strings.Split(a, ".") {
		other := strings.Split(b, ".")[i]
		if len(part) < len(other) {
			return -1
		}
		if len(part) > len(other) {
			return 1
		}
		if cmp := strings.Compare(part, other); cmp != 0 {
			return cmp
		}
	}
	return 0
}
