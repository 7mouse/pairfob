import type { ComponentProps } from "react";
import { usePresence } from "../../react/use-presence";
import { MOTION_MS } from "../dom/motion";

type FoldProps = ComponentProps<"div"> & {
  open: boolean;
  /** Also open from shut when it first appears, for a block that mounts already open. */
  appear?: boolean;
  /**
   * Render the content only while the block is open or on its way shut, for
   * content that is costly to keep (a long list) or must not exist while
   * hidden (a form that would hold a draft). It mounts in the commit that
   * opens the block and goes once the block has shut.
   */
  lazy?: boolean;
  /** Class for the inner box, the one that holds the content and clips it while the block moves. */
  bodyClassName?: string;
};

/**
 * A block that opens and shuts by height (`.fold`, shared/ui/styles/motion-kit).
 *
 * The content stays mounted either way unless the block is `lazy`, so what it
 * holds keeps its state and a closing block has something to show on the way.
 * Shut, it is `inert`: no tab stop, no press and nothing for a screen reader
 * inside.
 */
export function Fold({ open, appear = false, lazy = false, className = "", bodyClassName = "", children, ...props }: FoldProps) {
  const kept = usePresence(open, MOTION_MS.panel);
  return <div {...props} className={`fold${open ? "" : " is-shut"}${appear ? " fold-appear" : ""}${className ? ` ${className}` : ""}`} inert={!open}>
    <div className={`fold-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{lazy && !kept.mounted ? null : children}</div>
  </div>;
}
