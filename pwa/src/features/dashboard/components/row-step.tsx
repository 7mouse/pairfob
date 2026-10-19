import { Swap } from "../../../shared/ui/primitives";
import type { RowStep } from "../../../lib/pane-step";

/**
 * An agent's step on one line: its kind or result, then its target in the code
 * face, and a breathing dot while the step has no answer yet. A new step fades
 * in. The list rows and the desk's "needs you" tickets both draw it.
 */
export function RowStepText({ step }: { step: RowStep }) {
  return (
    <Swap on={`${step.lead}|${step.object}`} className={`row-step${step.failed ? " is-failed" : ""}`}>
      <span className="row-step-lead">{step.lead}</span>
      {step.object ? <span className="row-step-object">{step.object}</span> : null}
      {step.running ? <span className="row-step-run" aria-hidden="true" /> : null}
    </Swap>
  );
}
