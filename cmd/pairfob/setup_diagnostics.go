package main

import (
	"fmt"
	"io"
	"os"

	runtimeapi "pairfob/internal/runtime"
)

func herdrTerminalCommand() string {
	binary, err := runtimeapi.ResolveHerdrBinary()
	if err != nil {
		return "herdr"
	}
	command := shellQuote(binary)
	if socket := os.Getenv("HERDR_SOCKET_PATH"); socket != "" {
		command = "HERDR_SOCKET_PATH=" + shellQuote(socket) + " " + command
	}
	if config := os.Getenv("HERDR_CONFIG_PATH"); config != "" {
		command = "HERDR_CONFIG_PATH=" + shellQuote(config) + " " + command
	}
	return command
}

func writeHerdrMaintenance(w io.Writer) {
	f, err := localHerdrFiles()
	if err != nil {
		fmt.Fprintf(w, "  Herdr files unavailable: %v\n", err)
		return
	}
	r, err := f.receipt()
	if err != nil {
		fmt.Fprintln(w, "  Herdr updates: installation source is external or unknown; use its original installer.")
	} else {
		fmt.Fprintf(w, "  Herdr file  %s at %s (managed by Pairfob)\n", r.Release.Version, r.Path)
		fmt.Fprintln(w, "  Herdr update: pairfob setup --update-herdr (running tasks are kept)")
	}
	var tx herdrTransaction
	if err := readHerdrJSON(f.path("update.json"), &tx); err == nil {
		fmt.Fprintf(w, "  Herdr update state: %s; candidate %s. Check the running version above.\n", tx.Phase, tx.Next.Release.Version)
	} else if !os.IsNotExist(err) {
		fmt.Fprintf(w, "  Herdr update state cannot be read: %v\n", err)
	}
}
