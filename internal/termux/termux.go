// Package termux adapts Pairfob to Termux on Android. The released binary is
// built for linux/arm64, but Android has no /etc/resolv.conf or CA bundle and no
// systemd/launchd, so the same commands need Termux-specific lookups.
package termux

import (
	"os"
	"path/filepath"
	"strings"
)

const defaultPrefix = "/data/data/com.termux/files/usr"

// Prefix returns the Termux installation prefix. PREFIX is set by every Termux
// shell; the default path keeps the daemon working when a supervisor starts it
// without a login environment.
func Prefix() string {
	if prefix := strings.TrimRight(os.Getenv("PREFIX"), "/"); filepath.IsAbs(prefix) {
		return prefix
	}
	if info, err := os.Stat(defaultPrefix); err == nil && info.IsDir() {
		return defaultPrefix
	}
	return ""
}

// Enabled reports whether this process runs inside Termux. The marker directory
// only exists in a Termux prefix, so a regular Linux host with PREFIX exported
// is not treated as Android.
func Enabled() bool {
	prefix := Prefix()
	if prefix == "" {
		return false
	}
	if _, err := os.Stat(filepath.Join(prefix, "etc", "termux")); err == nil {
		return true
	}
	if os.Getenv("TERMUX_VERSION") != "" {
		return true
	}
	// A daemon started without a login environment may miss both markers.
	if _, err := os.Stat("/system/build.prop"); err == nil {
		return prefix == defaultPrefix || strings.HasSuffix(prefix, "/com.termux/files/usr")
	}
	return false
}

// CACertFile is the bundle installed by Termux's ca-certificates package.
func CACertFile() string {
	prefix := Prefix()
	if prefix == "" {
		return ""
	}
	return filepath.Join(prefix, "etc", "tls", "cert.pem")
}

// ResolvConf is the resolver configuration Termux tooling writes.
func ResolvConf() string {
	prefix := Prefix()
	if prefix == "" {
		return ""
	}
	return filepath.Join(prefix, "etc", "resolv.conf")
}

// ServiceDir is the runit service directory read by termux-services.
func ServiceDir() string {
	prefix := Prefix()
	if prefix == "" {
		return ""
	}
	return filepath.Join(prefix, "var", "service", "pairfob")
}

// Configure points Go at the Termux CA bundle and resolver when Android hides
// the paths it normally uses. It is a no-op elsewhere and never overrides an
// explicit SSL_CERT_FILE.
func Configure() {
	if !Enabled() {
		return
	}
	configureCertificates(os.Getenv, os.Setenv, CACertFile())
	configureResolver("/etc/resolv.conf", ResolvConf())
}
