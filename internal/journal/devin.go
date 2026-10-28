package journal

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"time"
)

var devinSessionID = regexp.MustCompile(`^[0-9A-Za-z][0-9A-Za-z_-]{0,127}$`)

// The active Devin transcript is the ancestry of main_chain_id. Its shared
// database also contains abandoned retries and subagent branches.
func (r *Reader) loadDevinStore(ref Ref, entry *storeEntry) ([]storeRecord, string, bool, error) {
	root := r.NativeRoots[ref.Agent]
	db, err := verifiedRegular(root, filepath.Join(root, "sessions.db"))
	if err != nil {
		return nil, "", false, err
	}
	stamp := db + ":" + fileStamp(db) + ":" + fileStamp(db+"-wal")
	if entry.snapshot != nil && entry.err == nil && stamp == entry.stamp {
		return nil, stamp, true, nil
	}
	query := r.sqlite
	if query == nil {
		query = runSQLite
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	// One statement keeps the metadata and chain in one SQLite read snapshot.
	sql := fmt.Sprintf(`with recursive chain(node_id,parent_node_id,chat_message,depth) as (
 select n.node_id,n.parent_node_id,n.chat_message,0 from message_nodes n join sessions s on n.session_id=s.id and n.node_id=s.main_chain_id where s.id='%[1]s' and s.hidden=0
 union all
 select n.node_id,n.parent_node_id,n.chat_message,c.depth+1 from message_nodes n join chain c on n.node_id=c.parent_node_id where n.session_id='%[1]s' and c.depth<2000
 ) select s.id,substr(s.title,1,256) as title,s.main_chain_id,c.node_id,c.parent_node_id,c.chat_message,c.depth from sessions s left join chain c on 1=1 where s.id='%[1]s' and s.hidden=0 order by c.depth desc limit 2002;`, ref.Value)
	data, err := query(ctx, db, sql)
	var rows []struct {
		ID, Title string
		Tip       *int64 `json:"main_chain_id"`
		IDNode    *int64 `json:"node_id"`
		Parent    *int64 `json:"parent_node_id"`
		Message   string `json:"chat_message"`
		Depth     int    `json:"depth"`
	}
	if err != nil || len(data) > maxScanBytes || json.Unmarshal(data, &rows) != nil || len(rows) == 0 || len(rows) > 2000 {
		return nil, "", false, ErrUnavailable
	}
	var records []storeRecord
	seen := map[int64]bool{}
	for i, row := range rows {
		if row.ID != ref.Value {
			return nil, "", false, ErrUnavailable
		}
		if row.IDNode == nil {
			if len(rows) == 1 && row.Tip == nil {
				break
			}
			return nil, "", false, ErrUnavailable
		}
		if seen[*row.IDNode] || (i == 0 && row.Parent != nil) || (i > 0 && (row.Parent == nil || rows[i-1].IDNode == nil || *row.Parent != *rows[i-1].IDNode)) {
			return nil, "", false, ErrUnavailable
		}
		seen[*row.IDNode] = true
		if i == len(rows)-1 && (row.Tip == nil || *row.IDNode != *row.Tip) {
			return nil, "", false, ErrUnavailable
		}
		parsed, ok := devinMessage([]byte(row.Message))
		if !ok {
			return nil, "", false, ErrUnavailable
		}
		records = append(records, parsed...)
	}
	entry.title = Title{Name: titleText(rows[0].Title, 256), Prompt: firstStorePrompt(records)}
	return records, stamp, false, nil
}

func devinMessage(raw []byte) ([]storeRecord, bool) {
	var m struct {
		Role     string          `json:"role"`
		Content  json.RawMessage `json:"content"`
		Thinking json.RawMessage `json:"thinking"`
		Metadata struct {
			User bool            `json:"is_user_input"`
			At   json.RawMessage `json:"created_at"`
		} `json:"metadata"`
		Calls []struct {
			ID, Name  string
			Arguments json.RawMessage `json:"arguments"`
		} `json:"tool_calls"`
		CallID  string `json:"tool_call_id"`
		IsError bool   `json:"is_error"`
	}
	if json.Unmarshal(raw, &m) != nil {
		return nil, false
	}
	at := recordTime(m.Metadata.At)
	text := kimiText(m.Content)
	var records []storeRecord
	switch m.Role {
	case "system":
	case "user":
		if m.Metadata.User {
			records = append(records, storeRecord{Kind: storeUser, Text: visibleCodexUserText(text), At: at})
		}
	case "assistant":
		if text != "" {
			records = append(records, storeRecord{Kind: storeAssistant, Text: text, At: at})
		}
		for _, call := range m.Calls {
			records = append(records, storeRecord{Kind: storeTool, Name: call.Name, Call: call.ID, Input: string(call.Arguments), At: at})
		}
	case "tool":
		if m.CallID == "" {
			return nil, false
		}
		state := "done"
		if m.IsError {
			state = "error"
		}
		records = append(records, storeRecord{Kind: storeResult, Call: m.CallID, Output: text, State: state, At: at})
	default:
		return nil, false
	}
	return records, true
}
