import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Move focus onto an element the moment it becomes the view's entry point.
 *
 * The C3b drill swaps one view for another rather than navigating, so without
 * this the focused control is unmounted and focus falls to `<body>` — keyboard
 * and screen-reader users land back at the top of the document with nothing
 * announced (issue #437 item 2).
 */
export function useAutoFocus<T extends HTMLElement>(active: boolean): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active]);
  return ref;
}
