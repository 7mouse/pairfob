package journal

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// TurnActivity is what a list row shows about an agent's current turn: the
// step it is on and, once the turn has ended, what the turn came to. It never
// carries thinking or reply text, tool input or tool output. See
// proto/agent-activity.md.
type TurnActivity struct {
	// Type is "tool", "thinking" or "assistant".
	Type string
	// Name, Label and State describe a tool step only.
	Name  string
	Label string
	State string
	// At is the latest record time in the turn, epoch ms; 0 when none is stamped.
	At int64
	// Turn is set only when asked for and the whole turn is in the window.
	Turn *TurnSummary
}

type TurnSummary struct {
	Steps       int
	Files       int
	Plan        string
	Failed      bool
	Interrupted bool
}

// TurnActivityMode picks the step a row shows for the agent's status.
type TurnActivityMode int

const (
	// TurnWorking shows the latest step.
	TurnWorking TurnActivityMode = iota
	// TurnBlocked shows the tool the agent is waiting on, else the latest step.
	TurnBlocked
	// TurnDone shows the latest step and the turn's outcome.
	TurnDone
)

const (
	// turnActivityItems is the window read for a row: enough for most turns,
	// small enough that the shared trace cache serves repeated snapshots.
	turnActivityItems = 200
	// maxActivityLabelBytes bounds a label in every snapshot; trace labels
	// are already one line of at most maxTraceLabelRunes runes.
	maxActivityLabelBytes = 200
	maxActivityNameBytes  = 256
)

var planProgress = regexp.MustCompile(`^\d+/\d+$`)

// planTools are the tools whose label is plan progress ("3/5").
var planTools = map[string]bool{"todowrite": true, "update_plan": true, "todo": true, "todoread": true}

// ReadTurnActivity reduces the newest trace summary window to a row's
// activity. An unsupported or unreadable transcript, or a turn with no step
// yet, reports false: the row keeps its plain description.
func (r *Reader) ReadTurnActivity(ref Ref, mode TurnActivityMode) (TurnActivity, bool) {
	if !r.Supports(ref) {
		return TurnActivity{}, false
	}
	page, err := r.ReadTraceSummaryWith(ref, nil, turnActivityItems, TraceOptions{Markers: true, Labels: true, Times: true, Writes: true})
	if err != nil {
		return TurnActivity{}, false
	}
	return reduceTurnActivity(page.Items, page.NextCursor != nil, mode)
}

// reduceTurnActivity reads the current turn: the items after the last user
// prompt or command. older reports that items before the window exist, so a
// window without a turn head holds only the tail of a turn.
func reduceTurnActivity(items []TraceSummaryItem, older bool, mode TurnActivityMode) (TurnActivity, bool) {
	head := -1
	for i := len(items) - 1; i >= 0; i-- {
		if turnHead(items[i].Type) {
			head = i
			break
		}
	}
	turn := items[head+1:]
	step := -1
	for i := len(turn) - 1; i >= 0; i-- {
		if activityStep(turn[i].Type) {
			step = i
			break
		}
	}
	if step < 0 {
		return TurnActivity{}, false
	}
	if mode == TurnBlocked {
		for i := len(turn) - 1; i >= 0; i-- {
			if turn[i].Type == "tool" && turn[i].State == "running" {
				step = i
				break
			}
		}
	}
	item := turn[step]
	activity := TurnActivity{Type: item.Type}
	if item.Type == "tool" {
		activity.Name = clipActivityText(item.Name, maxActivityNameBytes)
		activity.Label = clipActivityText(item.Label, maxActivityLabelBytes)
		activity.State = item.State
	}
	for _, candidate := range turn {
		activity.At = max(activity.At, candidate.At)
	}
	if mode == TurnDone && (head >= 0 || !older) {
		activity.Turn = summarizeTurn(turn)
	}
	return activity, true
}

func activityStep(kind string) bool {
	return kind == "tool" || kind == "thinking" || kind == "assistant"
}

func summarizeTurn(turn []TraceSummaryItem) *TurnSummary {
	summary := &TurnSummary{}
	files := map[string]bool{}
	for _, item := range turn {
		switch item.Type {
		case EventInterrupt:
			summary.Interrupted = true
		case "tool":
			summary.Steps++
			// A write counts only once the edit went through (agent-trace-writes.md).
			if item.State == "done" {
				for _, path := range item.Writes {
					files[path] = true
				}
			}
			if planTools[strings.ToLower(item.Name)] && planProgress.MatchString(item.Label) {
				summary.Plan = item.Label
			}
		}
	}
	summary.Files = len(files)
	for i := len(turn) - 1; i >= 0; i-- {
		if turn[i].Type == "assistant" {
			break
		}
		if turn[i].Type == "tool" {
			summary.Failed = turn[i].State == "error"
			break
		}
	}
	return summary
}

// clipActivityText keeps a name or label within its byte bound on a rune boundary.
func clipActivityText(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	cut := limit
	for cut > 0 && !utf8.RuneStart(text[cut]) {
		cut--
	}
	return text[:cut]
}
