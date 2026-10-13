/**
 * The session's measured moves (a button whose label changed width, a field
 * that lost its lines, a bubble sent to another row, an image growing out of
 * its thumbnail) are played with the shared `playMove`; this module keeps the
 * session's own import path for it.
 */
export { MOTION_EASE as MOVE_EASE, playMove } from "../../shared/ui/dom/motion";
