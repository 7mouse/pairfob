import { Check, Copy } from "lucide-react";
import { Fragment } from "react";
import { useCopied } from "../../react/use-copied";
import { Button } from "./button";
import { CopyAck } from "./copy-ack";

/**
 * A shell command the reader runs on the computer, with a copy button. The
 * result shows on the button for a moment and the button is itself again; the
 * command stays selectable either way. Each word is one box, so a narrow
 * line breaks between words and never after the hyphen inside a flag.
 */
export function CommandLine({ command, labels }: { command: string; labels: { copy: string; copied: string; failed: string } }) {
  const [copied, confirm] = useCopied<"copied" | "failed">();
  return <div className="command-line">
    <code>{command.split(" ").map((word, index) => <Fragment key={index}>{index ? " " : null}<span className="command-word">{word}</span></Fragment>)}</code>
    <Button className="set-action command-copy" onClick={() => {
      // Called inside the tap: some browsers only allow clipboard writes there.
      const write = navigator.clipboard?.writeText(command) ?? Promise.reject(new Error("no clipboard"));
      void write.then(() => confirm("copied"), () => confirm("failed"));
    }}>
      <CopyAck state={copied ?? "idle"}
        idle={<><Copy size={14} aria-hidden="true" />{labels.copy}</>}
        copied={<><Check size={14} aria-hidden="true" />{labels.copied}</>}
        failed={labels.failed} />
    </Button>
  </div>;
}
