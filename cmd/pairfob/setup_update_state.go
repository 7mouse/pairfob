package main

import (
	"errors"
	"fmt"
	"os"
)

// Recovery reconciles bytes and receipts, never repeats a server stop or claims
// a running version. The next explicit update still performs live checks.
func (f herdrFiles) recoverHerdrUpdate() error {
	var tx herdrTransaction
	if err := readHerdrJSON(f.path("update.json"), &tx); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	switch tx.Phase {
	case "staged", "rolled_back":
		return nil
	case "switching", "installed":
		if tx.Previous == nil {
			return errors.New("Herdr update has no previous installation record")
		}
		if err := tx.Next.matches(f.target); err == nil {
			return writeHerdrJSON(f.path("install.json"), tx.Next)
		}
		if err := tx.Previous.matches(f.target); err == nil {
			if err = writeHerdrJSON(f.path("install.json"), tx.Previous); err != nil {
				return err
			}
			return os.Remove(f.path("update.json"))
		}
		return fmt.Errorf("interrupted Herdr update does not match either recorded binary; inspect %s and %s", f.target, f.path("backup"))
	default:
		return errors.New("unknown Herdr update transaction state")
	}
}

func (f herdrFiles) requireSettledUpdate() error {
	var tx herdrTransaction
	if err := readHerdrJSON(f.path("update.json"), &tx); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if tx.Phase == "switching" || tx.Phase == "installed" {
		return fmt.Errorf("a previous Herdr update needs verification; run pairfob setup before another update; previous binary kept at %s", f.path("backup"))
	}
	return nil
}

func (f herdrFiles) finishVerifiedUpdate(version string) error {
	var tx herdrTransaction
	if err := readHerdrJSON(f.path("update.json"), &tx); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if tx.Phase != "installed" && tx.Phase != "switching" {
		return nil
	}
	if tx.Next.Release.Version != version {
		return fmt.Errorf("Herdr is running %s but the interrupted update installed %s; backup kept at %s", version, tx.Next.Release.Version, f.path("backup"))
	}
	if err := tx.Next.matches(f.target); err != nil {
		return err
	}
	if err := os.Remove(f.path("update.json")); err != nil {
		return err
	}
	_ = os.Remove(f.path("backup"))
	_ = os.Remove(f.path("candidate"))
	return nil
}
