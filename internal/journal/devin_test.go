package journal

import (
	"path/filepath"
	"testing"
	"time"
)

func TestDevinActiveChainObservation(t *testing.T) {
	root := t.TempDir()
	db := filepath.Join(root, "sessions.db")
	sqliteFixture(t, db, `create table sessions(id text,title text,main_chain_id integer,hidden integer);
create table message_nodes(session_id text,node_id integer,parent_node_id integer,chat_message text);
insert into sessions values('fix','Devin title',4,0),('other','Other',4,0);
insert into message_nodes values
('fix',1,null,'{"role":"system","content":"hidden system"}'),
('fix',2,1,'{"role":"user","content":"Fix titles","metadata":{"is_user_input":true}}'),
('fix',3,2,'{"role":"assistant","content":"Checking","tool_calls":[{"id":"c1","name":"Read","arguments":{"path":"main.ts"}}]}'),
('fix',4,3,'{"role":"tool","tool_call_id":"c1","content":"source"}'),
('fix',5,2,'{"role":"user","content":"hidden abandoned branch","metadata":{"is_user_input":true}}'),
('other',4,null,'{"role":"user","content":"hidden other session","metadata":{"is_user_input":true}}');`)
	r := &Reader{NativeRoots: map[string]string{"devin": root}}
	ref := Ref{Source: "herdr:devin", Agent: "devin", Kind: "id", Value: "fix"}
	checkNativeObservation(t, r, ref, "Fix titles", "Read", "done")
	sqliteFixture(t, db, `update sessions set title='Renamed' where id='fix';`)
	r.now = func() time.Time { return time.Now().Add(3 * time.Second) }
	if title := r.ReadTitle(ref); title.Name != "Renamed" {
		t.Fatal(title)
	}
	for _, sql := range []string{
		`update message_nodes set parent_node_id=99 where session_id='fix' and node_id=2;`,
		`update message_nodes set parent_node_id=4 where session_id='fix' and node_id=2;`,
		`update sessions set main_chain_id=99 where id='fix';`,
	} {
		sqliteFixture(t, db, sql)
		if _, err := r.loadStore(ref, true); err == nil {
			t.Fatal("broken ancestry accepted")
		}
	}
	ref.Value = "fix' OR 1=1--"
	if r.Supports(ref) {
		t.Fatal("SQL syntax accepted")
	}
}
