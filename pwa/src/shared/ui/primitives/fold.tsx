import type { ComponentProps } from "react";

type FoldProps = ComponentProps<"div"> & {
  open: boolean;
  /** Also open from shut when it first appears, for a block that mounts already open. */
  appear?: boolean;
  /** Class for the inner box, the one that holds the content and clips it while the block moves. */
  bodyClassName?: string;
};

/**
 * A block that opens and shuts by height (`.fold`, shared/ui/styles/motion-kit).
 *
 * The content stays mounted either way, so what it holds keeps its state and a
 * closing block has something to show on the way. Shut, it is `inert`: no tab
 * stop, no press and nothing for a screen reader inside.
 */
export function Fold({ open, appear = false, className = "", bodyClassName = "", children, ...props }: FoldProps) {
  return <div {...props} className={`fold${open ? "" : " is-shut"}${appear ? " fold-appear" : ""}${className ? ` ${className}` : ""}`} inert={!open}>
    <div className={`fold-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
  </div>;
}
