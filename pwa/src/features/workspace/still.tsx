import { memo, type ReactNode } from "react";

/**
 * A drawing that is kept as it stands while `still`.
 *
 * What is on its way out has to stay on the page as the reader last saw it:
 * the diff that dims until the next one is read, the detail that slides off
 * over the list. By then the store has already moved on, and drawing either of
 * them again would draw the new state into the old picture (no lines, no
 * notes). So while `still` nothing inside is rendered again, whatever is passed
 * as children; when it ends, the children are drawn as usual.
 *
 * Whoever holds a drawing still also puts it out of reach (`inert`): it shows
 * what was, and a press on it would act on what is.
 */
export const Still = memo(
  function Still({ children }: { still: boolean; children: ReactNode }) {
    return children;
  },
  (_, next) => next.still,
);
