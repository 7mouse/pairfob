import type { CSSProperties } from "react";

/**
 * Where the mark of a segmented strip stands (`workspace-thumb`): the chosen
 * segment's place among how many there are. The style sheet slides the mark
 * there, so the strip only says where "there" is. A strip with nothing chosen
 * (`index` under 0) shows no mark.
 */
export function thumbAt(index: number, count: number): CSSProperties {
  return {
    "--thumb-on": Math.max(index, 0),
    "--thumb-count": Math.max(count, 1),
    ...(index < 0 ? { "--thumb-shown": 0 } : {}),
  } as CSSProperties;
}
