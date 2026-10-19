package main

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

// Push preferences belong to the user, not the shell running an upgrade.
// Explicit nonempty install-time values override the previous unit. Other
// runtime settings retain their existing reconciliation rules.
func serviceBodyPreservingPush(layout serviceLayout) ([]byte, error) {
	body := unitBody(layout)
	previous, err := readServiceUnit(layout.UnitPath)
	if errors.Is(err, os.ErrNotExist) {
		return []byte(body), nil
	}
	if err != nil {
		return nil, fmt.Errorf("cannot preserve push settings; service definition left unchanged: %w", err)
	}
	before, err := readUnitRuntime(layout.GOOS, previous)
	if err != nil {
		return nil, fmt.Errorf("cannot preserve push settings; service definition left unchanged: %w", err)
	}
	for _, key := range []string{"PAIRFOB_PUSH", "PAIRFOB_VAPID_SUBJECT"} {
		value, exists := before.env[key]
		if !exists || os.Getenv(key) != "" {
			continue
		}
		if layout.GOOS == "darwin" {
			entry := "    <key>" + key + "</key>\n    <string>" + xmlEscape(value) + "</string>\n"
			body = strings.Replace(body, "    <key>HOME</key>", entry+"    <key>HOME</key>", 1)
		} else {
			entry := "Environment=" + key + "=" + systemdEnvironmentValue(value) + "\n"
			body = strings.Replace(body, "Environment=HOME=", entry+"Environment=HOME=", 1)
		}
	}
	return []byte(body), nil
}
