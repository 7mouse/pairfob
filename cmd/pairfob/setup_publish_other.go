//go:build !linux

package main

import "errors"

// renameNoReplace exists for the Linux fallback only; every other platform can
// publish with os.Link.
func renameNoReplace(string, string) error {
	return errors.New("hardlink publish is unsupported on this platform")
}
