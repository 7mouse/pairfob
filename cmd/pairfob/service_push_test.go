package main

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestPrepareInstallRejectsUnreadablePreferencesBeforeServiceControl(t *testing.T) {
	layout := runtimeDiffLayout(t, "darwin")
	writeUnit(t, layout, "invalid plist")
	called := false
	stubServiceRunner(t, func(args []string) ([]byte, error) {
		called = true
		return nil, nil
	})
	if err := prepareServiceInstall(layout); err == nil || !strings.Contains(err.Error(), "left unchanged") {
		t.Fatalf("err=%v", err)
	}
	if called {
		t.Fatal("invalid preferences reached the service manager")
	}
}

func TestReinstallPreservesPushPreferencesAndAllowsExplicitOverride(t *testing.T) {
	for _, goos := range []string{"darwin", "linux"} {
		t.Run(goos, func(t *testing.T) {
			layout := runtimeDiffLayout(t, goos)
			t.Setenv("PAIRFOB_PUSH", "0")
			t.Setenv("PAIRFOB_VAPID_SUBJECT", "https://example.com/contact?a=1&b=2")
			writeUnit(t, layout, unitBody(layout))
			t.Setenv("PAIRFOB_PUSH", "")
			t.Setenv("PAIRFOB_VAPID_SUBJECT", "")
			for i := 0; i < 2; i++ {
				var out bytes.Buffer
				if err := rewriteServiceUnit(layout, &out); err != nil {
					t.Fatal(err)
				}
				body, _ := os.ReadFile(layout.UnitPath)
				runtime, err := readUnitRuntime(goos, body)
				if err != nil || runtime.env["PAIRFOB_PUSH"] != "0" || runtime.env["PAIRFOB_VAPID_SUBJECT"] != "https://example.com/contact?a=1&b=2" {
					t.Fatalf("reinstall lost preferences: %+v %v", runtime, err)
				}
				if out.Len() != 0 {
					t.Fatalf("unchanged preferences reported: %s", out.String())
				}
			}
			t.Setenv("PAIRFOB_PUSH", "1")
			t.Setenv("PAIRFOB_VAPID_SUBJECT", "mailto:operator@example.com")
			if err := rewriteServiceUnit(layout, &bytes.Buffer{}); err != nil {
				t.Fatal(err)
			}
			body, _ := os.ReadFile(layout.UnitPath)
			runtime, err := readUnitRuntime(goos, body)
			if err != nil || runtime.env["PAIRFOB_PUSH"] != "1" || runtime.env["PAIRFOB_VAPID_SUBJECT"] != "mailto:operator@example.com" {
				t.Fatalf("explicit override lost: %+v %v", runtime, err)
			}
		})
	}
}
