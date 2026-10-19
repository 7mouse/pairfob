package state

import (
	"testing"
)

func TestVAPIDContactMigrationKeepsKeysAndCustomContact(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	old, err := store.LoadOrCreateVAPID("mailto:operator@localhost")
	if err != nil {
		t.Fatal(err)
	}
	for _, subject := range []string{"", "mailto:me@example.com", ""} {
		got, err := store.LoadOrCreateVAPID(subject)
		if err != nil {
			t.Fatal(err)
		}
		if got.Public != old.Public || got.Private != old.Private {
			t.Fatal("migration rotated subscription key")
		}
		want := subject
		if want == "" {
			want = defaultVAPIDSubject
		}
		if old.Subject == "mailto:me@example.com" && subject == "" {
			want = old.Subject
		}
		if got.Subject != want {
			t.Fatalf("subject=%q want=%q", got.Subject, want)
		}
		old = got
	}
	if _, err := store.LoadOrCreateVAPID("http://bad.example"); err == nil {
		t.Fatal("invalid override accepted")
	}
	got, err := store.LoadOrCreateVAPID("")
	if err != nil || got != old {
		t.Fatalf("invalid override changed state: %+v %v", got, err)
	}
}

func TestNewVAPIDUsesPublicContact(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	got, err := store.LoadOrCreateVAPID("")
	if err != nil || got.Subject != "https://pairfob.com" {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}
