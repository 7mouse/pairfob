//go:build linux

package main

import "golang.org/x/sys/unix"

// renameNoReplace publishes a finished file where hardlinks are unavailable.
// RENAME_NOREPLACE keeps the property os.Link gave the installer: an existing
// executable, including one installed while downloading, is never replaced.
func renameNoReplace(oldpath, newpath string) error {
	return unix.Renameat2(unix.AT_FDCWD, oldpath, unix.AT_FDCWD, newpath, unix.RENAME_NOREPLACE)
}
