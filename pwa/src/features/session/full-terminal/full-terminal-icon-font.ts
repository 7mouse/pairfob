import { ICON_FAMILY, iconScanner, type IconFace } from "../../../shared/ui/fonts/term-glyphs";

/** One character from each face: what a load is asked for. */
const SAMPLE: Record<IconFace, string> = { bmp: "\ue0a0", mdi: "\u{f0001}" };

/** After a face fails to arrive, how long icons go by before it is asked for again. */
export const ICON_FONT_RETRY_MS = 15_000;

type FontLoader = Pick<FontFaceSet, "load">;

/**
 * Icon faces for the complete terminal.
 *
 * xterm draws each glyph once, through a canvas, into an atlas it reuses. A
 * canvas draws with the faces that are loaded: it does not fetch one, and what
 * it drew is not drawn again when one arrives. So the frames are watched for
 * icon code points; the first from each face has that face loaded, and when it
 * is here the atlas is thrown away and the screen drawn again with it.
 *
 * The result takes each frame's bytes as they go to the terminal.
 */
export function iconFontWatcher(
  redraw: () => void,
  fonts: FontLoader | undefined = globalThis.document?.fonts,
  now: () => number = Date.now,
): (bytes: Uint8Array) => void {
  if (typeof fonts?.load !== "function") return () => undefined;
  const scan = iconScanner();
  const ready = new Set<IconFace>();
  const loading = new Set<IconFace>();
  const wanted = new Set<IconFace>();
  const failedAt = new Map<IconFace, number>();
  const load = (face: IconFace): void => {
    if (ready.has(face) || loading.has(face)) return;
    const failed = failedAt.get(face);
    if (failed !== undefined && now() - failed < ICON_FONT_RETRY_MS) return;
    loading.add(face);
    // A font set that throws is a face that failed, never a frame that was not written.
    let asked: Promise<FontFace[]>;
    try {
      asked = fonts.load(`16px ${ICON_FAMILY[face]}`, SAMPLE[face]);
    } catch (error) {
      asked = Promise.reject(error);
    }
    asked.then((faces) => {
      loading.delete(face);
      // No face answered: the rule is missing, and asking again changes nothing.
      ready.add(face);
      if (faces.length) redraw();
    }, () => {
      loading.delete(face);
      failedAt.set(face, now());
    });
  };
  return (bytes) => {
    if (ready.size === 2) return;
    for (const face of scan(bytes)) wanted.add(face);
    for (const face of wanted) load(face);
  };
}
