package termux

import (
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"time"
)

const resolverDialTimeout = 2 * time.Second

// configureCertificates makes Go read the Termux CA bundle. Go already honours
// SSL_CERT_FILE, so no certificate code needs to change.
func configureCertificates(getenv func(string) string, setenv func(string, string) error, path string) bool {
	if path == "" || getenv("SSL_CERT_FILE") != "" {
		return false
	}
	if info, err := os.Stat(path); err != nil || info.IsDir() {
		return false
	}
	return setenv("SSL_CERT_FILE", path) == nil
}

// configureResolver replaces Go's resolver when the host has no system
// resolv.conf. Android keeps DNS configuration out of the filesystem; Termux
// mirrors it into $PREFIX/etc/resolv.conf, so that file becomes the source.
func configureResolver(systemConf, termuxConf string) bool {
	if termuxConf == "" {
		return false
	}
	if _, err := os.Stat(systemConf); err == nil {
		return false
	}
	servers := readNameservers(termuxConf)
	if len(servers) == 0 {
		return false
	}
	net.DefaultResolver = resolverFor(servers)
	return true
}

func readNameservers(path string) []string {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var servers []string
	seen := map[string]bool{}
	for _, line := range strings.Split(string(body), "\n") {
		if i := strings.IndexByte(line, '#'); i >= 0 {
			line = line[:i]
		}
		fields := strings.Fields(line)
		if len(fields) != 2 || fields[0] != "nameserver" {
			continue
		}
		server := fields[1]
		if net.ParseIP(server) == nil || seen[server] {
			continue
		}
		seen[server] = true
		servers = append(servers, server)
	}
	return servers
}

// resolverFor returns a resolver that dials the given servers directly. The
// dial address Go passes carries the system default (loopback); the Termux
// servers replace it.
func resolverFor(servers []string) *net.Resolver {
	return &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var lastErr error
			for _, server := range servers {
				dialer := net.Dialer{Timeout: resolverDialTimeout}
				conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(server, "53"))
				if err == nil {
					return conn, nil
				}
				lastErr = err
			}
			if lastErr == nil {
				lastErr = errors.New("no Termux nameservers configured")
			}
			return nil, lastErr
		},
	}
}
