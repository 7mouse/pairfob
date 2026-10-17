package termux

import (
	"net"
	"os"
	"path/filepath"
	"testing"
)

func TestEnabledRequiresTermuxMarker(t *testing.T) {
	prefix := t.TempDir()
	t.Setenv("PREFIX", prefix)
	t.Setenv("TERMUX_VERSION", "")
	if Enabled() {
		t.Fatal("regular prefix was treated as Termux")
	}
	if err := os.MkdirAll(filepath.Join(prefix, "etc", "termux"), 0o755); err != nil {
		t.Fatal(err)
	}
	if !Enabled() {
		t.Fatal("Termux marker was not detected")
	}
}

func TestPrefixFallsBackToDefaultPath(t *testing.T) {
	t.Setenv("PREFIX", "")
	if _, err := os.Stat(defaultPrefix); err != nil {
		t.Skip("no Termux install at the default prefix")
	}
	if Prefix() != defaultPrefix {
		t.Fatalf("Prefix()=%q", Prefix())
	}
}

func TestReadNameserversSkipsCommentsAndDuplicates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "resolv.conf")
	body := "# generated\nnameserver 8.8.8.8\nnameserver 8.8.4.4 # backup\nnameserver 8.8.8.8\nsearch lan\nnameserver not-an-ip\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	got := readNameservers(path)
	want := []string{"8.8.8.8", "8.8.4.4"}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v", got)
		}
	}
	if servers := readNameservers(filepath.Join(t.TempDir(), "missing")); servers != nil {
		t.Fatalf("missing file returned %v", servers)
	}
}

func TestConfigureCertificatesHonoursExplicitFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cert.pem")
	if err := os.WriteFile(path, []byte("cert"), 0o600); err != nil {
		t.Fatal(err)
	}
	explicit := func(string) string { return "/custom/ca.pem" }
	set := func(string, string) error { t.Fatal("overrode explicit SSL_CERT_FILE"); return nil }
	if configureCertificates(explicit, set, path) {
		t.Fatal("configured with an explicit SSL_CERT_FILE")
	}
	set = func(name, value string) error {
		if name != "SSL_CERT_FILE" || value != path {
			t.Fatalf("set %s=%s", name, value)
		}
		return nil
	}
	if !configureCertificates(func(string) string { return "" }, set, path) {
		t.Fatal("certificate bundle was not configured")
	}
	if configureCertificates(func(string) string { return "" }, set, filepath.Join(t.TempDir(), "missing")) {
		t.Fatal("missing bundle was configured")
	}
}

func TestConfigureResolverUsesTermuxFileOnlyWithoutSystemFile(t *testing.T) {
	dir := t.TempDir()
	conf := filepath.Join(dir, "resolv.conf")
	if err := os.WriteFile(conf, []byte("nameserver 192.0.2.1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	previous := net.DefaultResolver
	t.Cleanup(func() { net.DefaultResolver = previous })

	if !configureResolver(filepath.Join(dir, "etc-resolv.conf"), conf) {
		t.Fatal("Termux resolver was not installed")
	}
	if net.DefaultResolver == previous {
		t.Fatal("resolver unchanged")
	}

	net.DefaultResolver = previous
	system := filepath.Join(dir, "system-resolv.conf")
	if err := os.WriteFile(system, []byte("nameserver 127.0.0.1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if configureResolver(system, conf) {
		t.Fatal("system resolv.conf was overridden")
	}
	if net.DefaultResolver != previous {
		t.Fatal("resolver replaced despite a system file")
	}
}

func TestResolverForPrefersGo(t *testing.T) {
	r := resolverFor([]string{"192.0.2.1"})
	if r == nil || !r.PreferGo || r.Dial == nil {
		t.Fatalf("%+v", r)
	}
}
