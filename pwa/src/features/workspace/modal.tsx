import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DeskFormContext, dialogClass } from "../../shared/ui/overlay/desk-form";
import { useDialogLifecycle } from "../../shared/ui/overlay/dialog-lifecycle";
import { SheetContent } from "../../shared/ui/overlay/sheet-content";
import { Button } from "../../shared/ui/primitives";

type WorkspaceDialogProps = {
  className: string;
  titleId: string;
  title?: string;
  sheet?: boolean;
  onDismiss: () => void;
  children: ReactNode;
};

/**
 * Native `<dialog>` for the branch sheet. Its children learn from
 * `DeskFormContext` whether it is drawn as the desk form, as in any shared
 * dialog: Cancel there is `onDismiss`. (A line note is written in place, under
 * its line, and has no dialog: `note-inline`.)
 */
export function WorkspaceDialog({ className, titleId, title, sheet = false, onDismiss, children }: WorkspaceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusFirst = () => {
    formRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled):not(.sheet-close)")?.focus();
  };
  const deskForm = useDialogLifecycle({ dialog: dialogRef, onDismiss, onClose: onDismiss, restoreFocus: true,
    sheet: sheet ? { form: formRef, scroller: bodyRef } : undefined,
    focus: focusFirst });
  const desk = useMemo(() => deskForm ? { cancel: onDismiss } : null, [deskForm, onDismiss]);
  // The sheet's bar and the card's footer are different buttons. A window that
  // crosses the tier under the open dialog draws the one for the other, and a
  // button that held focus is gone: the dialog starts again where it first put
  // the reader, as the shared frame does.
  const drawn = useRef(deskForm);
  useLayoutEffect(() => {
    if (drawn.current === deskForm) return;
    drawn.current = deskForm;
    if (formRef.current && !formRef.current.contains(document.activeElement)) focusFirst();
  });

  return createPortal(
    <dialog
      ref={dialogRef}
      className={dialogClass(className, deskForm)}
      data-react-modal=""
      aria-labelledby={titleId}
    >
      <form
        ref={formRef}
        method="dialog"
        onSubmit={(event) => event.preventDefault()}
      >
        <DeskFormContext value={desk}>
          {sheet ? <SheetContent title={title ?? ""} titleId={titleId} onDismiss={onDismiss} bodyRef={bodyRef}>
            {children}
          </SheetContent> : children}
        </DeskFormContext>
      </form>
    </dialog>,
    document.body,
  );
}

export function SheetItem({ label, onPick, variant = "", disabled = false }: {
  label: string; onPick: () => void | Promise<void>; variant?: "" | "danger"; disabled?: boolean;
}) {
  return <Button className={`menu-item${variant ? ` menu-${variant}` : ""}`} disabled={disabled} onClick={() => {
    window.setTimeout(() => void onPick(), 0);
  }}>{label}</Button>;
}
