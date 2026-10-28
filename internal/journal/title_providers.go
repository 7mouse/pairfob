package journal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// lineTitle uses the provider's existing user-content filter. Reading only the
// beginning keeps a follow-up in a long session from becoming its task name.
func (r *Reader) lineTitle(ref Ref) (Title, bool) {
	path, err := r.transcriptPath(ref, false)
	if err != nil {
		return Title{}, false
	}
	file, err := openActivityFile(r.transcriptBase(ref.Agent), path)
	if err != nil {
		return Title{}, false
	}
	defer file.Close()
	var title Title
	parse := historyParserFor(ref.Agent)
	err = forEachLine(io.LimitReader(file, titleReadBytes), maxTranscriptLine, func(line []byte, _ int, oversized bool) bool {
		if !oversized {
			if message, ok := parse(line); ok && message.Role == "user" {
				title.Prompt = promptTitle(message.Text)
			}
		}
		return title.Prompt == ""
	})
	return title, err == nil
}

func (r *Reader) grokTitle(ref Ref) (Title, bool) {
	title, _ := r.lineTitle(ref)
	path, err := r.transcriptPath(ref, false)
	if err != nil {
		return title, false
	}
	var summary struct {
		Info           struct{ ID string } `json:"info"`
		GeneratedTitle string              `json:"generated_title"`
	}
	if !readTitleJSON(r.transcriptBase(ref.Agent), filepath.Join(filepath.Dir(path), "summary.json"), &summary) || summary.Info.ID != ref.Value {
		return title, false
	}
	title.Name = titleText(summary.GeneratedTitle, 256)
	return title, true
}

func (r *Reader) opencodeTitle(ref Ref) (Title, bool) {
	if _, present := r.opencodeDB(r.OpencodeRoot, "opencode"); present {
		return r.nativeStoreTitle(ref)
	}
	base := filepath.Join(r.OpencodeRoot, "storage")
	paths, err := filepath.Glob(filepath.Join(base, "session", "*", ref.Value+".json"))
	if err != nil || len(paths) != 1 {
		return Title{}, false
	}
	var session struct{ ID, Title string }
	if !readTitleJSON(base, paths[0], &session) || session.ID != ref.Value {
		return Title{}, false
	}
	title := Title{Name: titleText(session.Title, 256)}
	if title.Name == "" {
		// loadOpencode retains the newest messages in very long sessions. A
		// truncated head cannot supply the first request.
		root, err := os.OpenRoot(base)
		if err == nil {
			messages := opencodeEntries(root.FS(), "message/"+ref.Value, opencodeMessageFile)
			root.Close()
			if len(messages) <= maxOpencodeMessages {
				records, _, err := r.loadOpencode(ref.Value, &storeEntry{})
				if err == nil {
					title.Prompt = firstStorePrompt(records)
				}
			}
		}
	}
	return title, true
}

func (r *Reader) hermesTitle(ref Ref) (Title, bool) {
	db, err := r.hermesDB()
	if err != nil {
		return Title{}, false
	}
	query := r.sqlite
	if query == nil {
		query = runSQLite
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	data, err := query(ctx, db, fmt.Sprintf("select id, substr(title,1,256) as title from sessions where id='%s' limit 1;", ref.Value))
	var rows []struct{ ID, Title string }
	if err != nil || len(data) > 8192 || json.Unmarshal(data, &rows) != nil || len(rows) != 1 || rows[0].ID != ref.Value {
		return Title{}, false
	}
	title := Title{Name: titleText(rows[0].Title, 256)}
	if title.Name == "" {
		if records, err := r.loadHermes(ref.Value); err == nil {
			title.Prompt = firstStorePrompt(records)
		}
	}
	return title, true
}

func firstStorePrompt(records []storeRecord) string {
	for _, record := range records {
		if record.Kind == storeUser {
			if prompt := promptTitle(record.Text); prompt != "" {
				return prompt
			}
		}
	}
	return ""
}

func readTitleJSON(base, path string, value any) bool {
	file, err := openActivityFile(base, path)
	if err != nil {
		return false
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, titleReadBytes+1))
	return err == nil && len(data) <= titleReadBytes && json.Unmarshal(data, value) == nil
}

func (r *Reader) kiloTitle(ref Ref) (Title, bool) {
	if _, present := r.opencodeDB(r.NativeRoots["kilo"], "kilo"); present {
		return r.nativeStoreTitle(ref)
	}
	reader := &Reader{OpencodeRoot: r.NativeRoots["kilo"]}
	return reader.opencodeTitle(ref)
}
