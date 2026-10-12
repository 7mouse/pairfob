package journal

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// Tool writes are the files a tool call named as its target: an edit, a new
// file, a deletion or a patch. Whether it wrote them is the call's state; a
// client counts a path as written only for a call that is done. Clients opt in with TraceOptions.Writes
// (GetConfig.capabilities.trace_writes) to show which files a turn touched;
// older clients reject unknown item keys. See proto/agent-trace-writes.md.
//
// Only tools that say which file they write are read. A shell command can
// write anything and names nothing, so it reports no paths: the list is what
// the agent's own edit tools declared, not everything that changed on disk.

const (
	maxTraceWrites     = 16
	maxTraceWriteRunes = 1024
)

// writeTools are the edit tools of the supported agents, by name with case and
// punctuation removed: Claude Code (Edit, Write, MultiEdit, NotebookEdit),
// Codex (apply_patch), Cursor (StrReplace, Write, Delete, EditNotebook,
// edit_file, search_replace, delete_file), Pi and opencode (edit, write,
// multiedit, patch), Hermes (write_file, patch) and the generic editor tools
// (str_replace_editor, str_replace_based_edit_tool, create_file).
var writeTools = map[string]bool{
	"edit": true, "write": true, "multiedit": true, "notebookedit": true, "editnotebook": true,
	"applypatch": true, "patch": true,
	"strreplace": true, "searchreplace": true, "editfile": true, "writefile": true, "createfile": true,
	"deletefile": true, "delete": true,
	"strreplaceeditor": true, "strreplacebasededittool": true,
}

// writePathKeys are the input keys that name the file an edit tool writes.
var writePathKeys = []string{"file_path", "filePath", "path", "file", "target_file", "filename", "notebook_path", "target_notebook"}

func writeToolName(name string) string {
	var b strings.Builder
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

// toolWrites lists the files a tool call wrote, as the tool named them
// (absolute, or relative to the agent's working directory). It returns nil
// for anything that is not an edit tool or names no file.
func toolWrites(name, input string) []string {
	if !writeTools[writeToolName(name)] {
		return nil
	}
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return nil
	}
	fields := inputFields(trimmed)
	if fields == nil {
		// Codex sends apply_patch its patch as raw text.
		return writePaths(patchFiles(input))
	}
	// The generic editor tool also reads: `command: "view"` writes nothing.
	if command := stringValue(fields["command"]); command == "view" {
		return nil
	}
	if path := firstString(fields, writePathKeys); strings.TrimSpace(path) != "" {
		return writePaths([]string{path})
	}
	for _, key := range labelPatchKeys {
		if files := patchFiles(stringValue(fields[key])); len(files) > 0 {
			return writePaths(files)
		}
	}
	return nil
}

// patchFiles names every file an apply_patch body touches, in order: updated,
// added and deleted files, and the new name of a moved one.
func patchFiles(text string) []string {
	var files []string
	for line := range strings.Lines(text) {
		// A marker starts its line. Indented, it is text of the file being patched.
		line = strings.TrimRight(line, "\r\n")
		for _, prefix := range []string{"*** Update File: ", "*** Add File: ", "*** Delete File: ", "*** Move to: "} {
			if file, ok := strings.CutPrefix(line, prefix); ok && strings.TrimSpace(file) != "" {
				files = append(files, strings.TrimSpace(file))
			}
		}
	}
	return files
}

// writePaths keeps the paths a client can use: one line of valid text, without
// control characters, never cut (a clipped path names another file), each
// once, at most maxTraceWrites.
func writePaths(paths []string) []string {
	var kept []string
	seen := map[string]bool{}
	for _, path := range paths {
		path = strings.TrimSpace(path)
		if path == "" || seen[path] || !utf8.ValidString(path) || utf8.RuneCountInString(path) > maxTraceWriteRunes {
			continue
		}
		if strings.ContainsFunc(path, func(r rune) bool { return unicode.IsControl(r) || r == 0x2028 || r == 0x2029 || r == 0xFEFF }) {
			continue
		}
		seen[path] = true
		kept = append(kept, path)
		if len(kept) == maxTraceWrites {
			break
		}
	}
	return kept
}
