import { Check, Copy } from "lucide-react";
import { t } from "../../lib/i18n";
import { useCopied } from "../../shared/react/use-copied";
import { Button, CopyAck } from "../../shared/ui/primitives";

const PAIR_COMMAND = "pairfob pair";

/**
 * The command that starts pairing, as a terminal line with a copy button. The
 * computer to control is often the one this browser runs on, so the command is
 * one click from its terminal. The copy result shows on the button for a
 * moment, in the room the button already has, so the command never reflows.
 */
export function PairCommand() {
  const [copied, confirm] = useCopied<"copied" | "failed">();
  const copy = () => {
    // Called inside the click: some browsers only allow clipboard writes there.
    const write = navigator.clipboard?.writeText(PAIR_COMMAND) ?? Promise.reject(new Error("no clipboard"));
    void write.then(() => confirm("copied"), () => confirm("failed"));
  };
  return (
    <div className="connect-command">
      <span className="connect-command-prompt" aria-hidden="true">~ %</span>
      <code>{PAIR_COMMAND}</code>
      <Button className="connect-command-copy" onClick={copy} aria-label={t("empty.copyAria", { command: PAIR_COMMAND })}>
        <CopyAck state={copied ?? "idle"}
          idle={<><Copy size={13} aria-hidden="true" />{t("empty.copy")}</>}
          copied={<><Check size={13} aria-hidden="true" />{t("empty.copied")}</>}
          failed={t("empty.copyFailed")} />
        {/* The button is named for its command, so the result is said here. */}
        <span className="sr-only" aria-live="polite">{copied === "copied" ? t("empty.copied") : copied === "failed" ? t("empty.copyFailed") : ""}</span>
      </Button>
    </div>
  );
}
