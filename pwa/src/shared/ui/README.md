# Shared UI

Keep presentation and local interaction here; pass business state and actions in
from features. Shared UI must not import pages, domain stores or protocol clients.
The architecture tests enforce that dependency direction.

Use these existing modules before adding another visually equivalent control:

- `primitives/segmented-control`: `SegmentedControl` and `SegmentedOption` own
  radio semantics, selection classes, one tab stop, arrow/Home/End navigation
  and disabled-item skipping. Business callbacks still own selection changes.
  Use `activation="manual"` when choosing an option closes a menu or triggers
  another screen. Terminal options may use `as={PadChromeButton}` to retain
  native pointer/focus protection. Native radio inputs (such as attachment
  compression choices) already have browser keyboard behavior; keep them native.
- `primitives/navigation`: `BackBar` for titled navigation, `TopbarActions` for
  trailing page actions. The action group keeps intrinsic button widths, right
  alignment and wrapping. Its styles belong to shared navigation, not a feature.
- `primitives/selection-row`: `SelectionRow` for a selectable title/description
  row, with optional leading content and a status badge. Keep a separate delete
  or forget action outside the row button; never nest interactive elements.
- `overlay/dialog-lifecycle`: native opening, cancel/backdrop guards, closing,
  optional sheet drag and cleanup. `ModalFrame` and `SheetFrame` use it for
  promise-based dialogs; controlled portals can use the same hook directly.
  `presentModal` owns promise settlement and focus restoration for its dialogs.
  Controlled portals opt into `restoreFocus`; do not give both layers ownership.
- `overlay/sheet-content`: the shared sheet handle, heading, close target and
  scrollable body. Keep forms and validation in their owning feature.
- The desk form (a dialog a mouse or the keyboard opened beside the list) has
  one anatomy and one order, the document's and the eye's alike: title, form,
  footer (`DeskCancel`, then the action), corner close (`DeskClose`, which
  `ModalFrame deskClose` and `SheetContent` write last). `DeskCancel` draws
  nothing in a sheet; a footer button of your own takes the `desk-action`
  mixins. `useDeskEnter` gives a form Enter from its fields and its choices.
  Tab is kept inside every dialog by the lifecycle; do not add a trap.
- A sheet's pinned footer is written through `SheetFooter`
  (`overlay/sheet-content`): the bottom sheet keeps it inside the scroller, the
  desk card places it under the scrolling body, so a scrollbar never moves it.
- Escape undoes the last step first. A step taken inside a dialog (a question
  asked in place, a list that took the form's place) registers with
  `useEscapeStep` (`overlay/escape-steps`); a pushed page and the dialog follow.
  A dialog opened over another as its next step takes `stepClass()`.
- A refused submit leaves the reader in the field it is about and a form that
  locks while it runs never drops focus onto the page: `focusRefused` and
  `holdFocus` (`overlay/form-focus`).

Reuse `Button`, `EmptyState`, `StatusLine`, setting rows and menu primitives as
appropriate. `Button` deliberately retains native props and only defaults the
button type; it does not own business loading or mutation state. Specialized
terminal keys, board tabs and the camera scanner retain their own interactions.

Motion that more than one screen needs lives here too, so the same change moves
the same way everywhere (`styles/motion-kit`, emitted by `styles/motion`):

- `primitives/fold`: `Fold` opens and shuts a block by height and keeps its
  content mounted; shut, it is `inert`. Use it for a group, a row joining or
  leaving a list, a form that grows a field. Do not swap a block in with
  `hidden` or a conditional when its neighbours would jump. `lazy` draws the
  content only while the block is open or on its way shut, for a long list or
  a form that must not exist while hidden; a test that goes on to say the
  content is gone waits for the fold first (`test-support/exit`).
- `primitives/swap`: `Swap` fades a word or a number in when its `on` value
  changes, never on a first paint or a repaint.
- `primitives/copy-ack` with `shared/react/use-copied`: the two faces of a copy
  button in one cell, so confirming a copy moves nothing.
- `shared/react/use-presence`: `usePresence` and `useKeptList` keep what just
  left mounted for its exit, marked `leaving`; `useKeptList` also marks a
  newcomer `entering`. Style the exit on an `is-leaving` class next to the
  thing's own entrance, shorter than the entrance.
- Classes `swap-in`, `pop-in` and `rise-in` for a node that is new by
  construction. `MOTION_MS` (`dom/motion`) names the `--dur-*` tokens for a
  timer that must wait out a CSS exit.
- Tokens beside the four durations (`styles/tokens`): `--dur-trace` for what an
  action leaves behind once it is over (a sweep across a row, a press ripple, a
  label flying off), and one beat for each kind of loop that says "still
  working": `--spin` a turn, `--sheen` a pass of a placeholder's sheen
  (`@keyframes skeleton-sheen`, on the placeholder's own `::after`), `--pulse`
  one way of a waiting pulse. A new spinner, placeholder or pulse reads these
  instead of stating seconds.
- `dom/motion` `playMove`: a move whose two ends are measured on the page (a
  button whose label changed width, a thing sent to another place), played
  with Web Animations on the same durations and curve. `overlay/sheet-height`
  `useSheetHeight` is the one for a sheet whose content is replaced whole.

A repaint is not a change: nothing here may run because a poll drew the same
data again. Nothing may tween the complete terminal's box either.
