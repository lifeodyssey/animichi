import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Dict } from "../../i18n/dictionaries";
import { useDict } from "../../i18n/LocaleProvider";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ComingSoonPopupProps {
  open: boolean;
  onClose: () => void;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/**
 * Tab wrap: wraps at the edges, and also from the dialog container itself —
 * initial focus lands there (tabIndex=-1), and without the wrap the browser's
 * Shift+Tab from that position escapes into the background page. An empty
 * dialog leaves the edges undefined and Tab passes through untouched.
 */
function tabEdges(root: HTMLElement): readonly [HTMLElement, HTMLElement] | null {
  const list = focusables(root);
  const first = list[0];
  const last = list[list.length - 1];
  if (first === undefined || last === undefined) return null;
  return [first, last];
}

function trapTabKey(event: KeyboardEvent, root: HTMLElement): void {
  if (event.key !== "Tab") return;
  const edges = tabEdges(root);
  if (edges === null) return;
  const [first, last] = edges;
  const active = document.activeElement;
  if (root.contains(active) && active !== root && active !== (event.shiftKey ? first : last)) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}

/**
 * Initial focus lands on the dialog container (WAI-ARIA modal pattern; it has
 * tabIndex=-1). The previously focused element (the trigger) is captured when
 * the dialog opens and restored on close, so keyboard users keep their place
 * in the page instead of dropping to body.
 */
function trapFocusIn(root: HTMLElement): () => void {
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const onKey = (event: KeyboardEvent) => { trapTabKey(event, root); };
  document.addEventListener("keydown", onKey);
  root.focus();
  return () => {
    document.removeEventListener("keydown", onKey);
    trigger?.focus();
  };
}

function useFocusTrap(open: boolean, rootRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const root = open ? rootRef.current : null;
    if (!root) return undefined;
    return trapFocusIn(root);
  }, [open, rootRef]);
}

function useEscapeToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
}

interface DialogProps {
  copy: Dict["coming_soon"];
  panelRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

function ComingSoonBody({ copy }: { copy: Dict["coming_soon"] }) {
  return <>
    <span className="coming-soon__badge">{copy.badge}</span>
    <h2 className="coming-soon__title">{copy.title}</h2>
    <p className="coming-soon__body">{copy.body}</p>
  </>;
}

function ComingSoonDialog({ copy, panelRef, onClose }: DialogProps) {
  return (
    <div className="coming-soon" role="dialog" aria-modal="true" aria-label={copy.title} tabIndex={-1} ref={panelRef} onClick={(event) => { event.stopPropagation(); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <button className="coming-soon__close" type="button" aria-label={copy.close} onClick={onClose}>×</button>
      <ComingSoonBody copy={copy} />
      <button className="coming-soon__action ds-button ds-button--primary" type="button" onClick={onClose}>{copy.action}</button>
    </div>
  );
}

/** 動森 "under construction" dialog: the one interactive surface of showcase mode. */
export function ComingSoonPopup({ open, onClose }: ComingSoonPopupProps) {
  const copy = useDict().coming_soon;
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);
  useEscapeToClose(open, onClose);
  if (!open) return null;
  return <div className="coming-soon__mask" role="presentation" onClick={onClose}>
    <ComingSoonDialog copy={copy} panelRef={panelRef} onClose={onClose} />
  </div>;
}
