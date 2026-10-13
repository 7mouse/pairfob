import { useRef } from "react";
import { useAppNotice } from "../../app/notice";
import type { Notice } from "../../app/notices-store";
import { usePresence } from "../../shared/react/use-presence";
import { MOTION_MS } from "../../shared/ui/dom/motion";
import { Feedback } from "../../shared/ui/primitives";

/**
 * The notice of an open session, placed by how long it is there.
 *
 * One that leaves by itself floats over the top of the transcript or buffer
 * (`.session-notice`, session-shell.scss). In the page's flow it pushed
 * everything under it down for as long as it showed and let it jump back, so a
 * press aimed at a control landed on whatever had slid under the pointer.
 * Floating, it takes no room, and since a notice is a line of text with nothing
 * to press it lets presses through to what it covers.
 *
 * One that stays keeps its place in the page: it is there until the reader does
 * something about it, and a float left over the first lines would hide them for
 * as long.
 *
 * A floating notice that is over leaves as it came: it stays for an exit's
 * length with the words it had (`is-leaving`) and then goes. One replaced by
 * another is the same line saying something new, and plays nothing.
 */

/**
 * An error raised to stay explains what the reader has to act on (a send that
 * was not confirmed, a prompt that failed). A status raised to stay is an
 * operation in flight: its result replaces it, so it floats as the result does
 * and the pair moves nothing.
 */
export function noticeKeepsItsPlace(notice: Notice): boolean {
  return notice.persistent === true && notice.tone === "error";
}

/**
 * `inPage` is for a note the session itself keeps on screen, whatever its tone.
 * `afloat` is for a screen whose box is not its own to resize: the complete
 * terminal's rows are the computer's terminal rows, so a notice that took a
 * place in its page would resize the program under it. There every notice
 * floats, the ones that stay included.
 */
export function SessionNotice({ value, inPage = false, afloat = false }: { value: Notice | null; inPage?: boolean; afloat?: boolean }) {
  const floats = value !== null && (afloat || !(inPage || noticeKeepsItsPlace(value)));
  const presence = usePresence(floats, MOTION_MS.press);
  const floated = useRef<Notice | null>(null);
  if (floats) floated.current = value;
  // One that takes its place in the page replaces the float outright.
  else if (value) floated.current = null;
  if (value && !floats) return <Feedback value={value} appNotice />;
  const shown = value ?? (presence.leaving ? floated.current : null);
  if (!shown) return null;
  return <div className={presence.leaving ? "session-notice is-leaving" : "session-notice"}>
    <Feedback value={shown} appNotice />
  </div>;
}

/** The application notice as a session places it; it repaints alone when the notice changes. */
export function SessionAppNotice({ afloat = false }: { afloat?: boolean }) {
  return <SessionNotice value={useAppNotice()} afloat={afloat} />;
}
