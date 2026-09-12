import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, PointerEvent, RefObject } from "react";

type Close = () => void;

/** A short grace period lets a pointer cross the gap into the quick-pick surface. */
function useHoverDismiss(close: Close) {
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => { clearTimeout(pending.current); }, []);
  useEffect(() => cancel, [cancel]);
  const schedule = () => { cancel(); pending.current = setTimeout(close, 150); };
  return { cancel, schedule };
}

function useOutsideDismiss(root: RefObject<HTMLDivElement | null>, open: boolean, close: Close) {
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: globalThis.PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) close(); };
    document.addEventListener("pointerdown", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); };
  }, [root, open, close]);
}

function blurOutside(event: FocusEvent<HTMLDivElement>, close: Close) {
  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
  close();
}

function leaveWithPointer(event: PointerEvent<HTMLDivElement>, close: Close) {
  if (event.pointerType !== "mouse") return;
  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
  const focused = document.activeElement;
  if (focused && event.currentTarget.contains(focused) && focused.matches(":focus-visible")) return;
  close();
}

function escapeDetails(event: KeyboardEvent, trigger: HTMLButtonElement | null, close: Close) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  trigger?.focus({ preventScroll: true });
  close();
}

/** Names are transient help; the parent owns the viewed place and selected places. */
export function usePlaceMarkerDetails() {
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => { setOpen(false); }, []);
  const hover = useHoverDismiss(close);
  const show = () => { hover.cancel(); setOpen(true); };
  useOutsideDismiss(root, open, close);
  const events = { onPointerEnter: (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType === "mouse") show(); }, onPointerLeave: (event: PointerEvent<HTMLDivElement>) => { leaveWithPointer(event, hover.schedule); }, onFocus: (event: FocusEvent<HTMLDivElement>) => { if (event.target.matches(":focus-visible")) show(); }, onBlur: (event: FocusEvent<HTMLDivElement>) => { blurOutside(event, close); }, onKeyDown: (event: KeyboardEvent) => { escapeDetails(event, trigger.current, close); } };
  return { root, trigger, open, show, events };
}
