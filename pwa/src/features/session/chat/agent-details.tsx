import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, Fold } from "../../../shared/ui/primitives";
import {
  chatDetailsOwner,
  choiceFromDetails,
  recordChatDetailChoice,
  type DetailsState,
} from "./details";

type AgentDetailsProps = {
  traceKey: string; className: string; auto?: boolean; kept?: DetailsState;
  dataTraceAnchor?: string; dataTraceOrdinal?: number; dataTraceOrdinalEnd?: number;
  onOpen?: (source: "automatic" | "toggle") => void;
  /** The line that always shows. It is the control when there is a body to open. */
  head: ReactNode; headClassName: string;
  /** What the head opens; without it the head is a plain line. */
  children?: ReactNode;
};

/** A different trace entry must not inherit the preceding tool's manual choice. */
export function AgentDetails(props: AgentDetailsProps) {
  return <DetailsStateView key={props.traceKey} {...props} />;
}

/**
 * A head that opens and shuts its body. A native `<details>` shuts in one
 * frame, so the body is a `Fold` under a button that says whether it is
 * expanded: the same Enter and Space, the same hidden-while-shut (the fold is
 * `inert`), and the body is seen leaving.
 */
function DetailsStateView({ traceKey, className, auto = false, kept, dataTraceAnchor,
  dataTraceOrdinal, dataTraceOrdinalEnd, onOpen, head, headClassName, children }: AgentDetailsProps) {
  const element = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const owner = useRef(chatDetailsOwner());
  const [choice, setChoice] = useState<boolean | null>(() => choiceFromDetails(kept, traceKey));
  const opened = choice ?? auto;
  const shown = useRef(opened);
  shown.current = opened;
  const latestOpen = useRef(onOpen);
  const openedByUser = useRef(false);
  latestOpen.current = onOpen;
  const live = () => owner.current === chatDetailsOwner();
  useLayoutEffect(() => {
    let retired = false;
    const alreadyRequested = openedByUser.current;
    openedByUser.current = false;
    if (opened && onOpen && !alreadyRequested) queueMicrotask(() => {
      if (!retired && live() && element.current?.isConnected && shown.current) latestOpen.current?.("automatic");
    });
    return () => { retired = true; };
  }, [opened, onOpen]);
  const toggle = (): void => {
    if (!live()) return;
    const next = !opened;
    setChoice(next);
    recordChatDetailChoice(traceKey, next, owner.current);
    if (next) {
      openedByUser.current = true;
      latestOpen.current?.("toggle");
    }
  };
  const body = children !== undefined && children !== null && children !== false;
  return <div ref={element} className={className} data-key={traceKey} data-trace-anchor={dataTraceAnchor}
    data-trace-ordinal={dataTraceOrdinal} data-trace-ordinal-end={dataTraceOrdinalEnd} data-auto-open={choice === null && auto ? "1" : undefined}
    data-user={choice === null ? undefined : choice ? "open" : "closed"}>
    {body
      ? <Button className={headClassName} aria-expanded={opened} aria-controls={bodyId} onClick={toggle}>{head}</Button>
      : <div className={headClassName}>{head}</div>}
    {body && <Fold id={bodyId} open={opened}>{children}</Fold>}
  </div>;
}
