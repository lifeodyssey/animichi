import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Dict } from "../../i18n/dictionaries";
import { useDict } from "../../i18n/context";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ComingSoonPopupProps {
  open: boolean;
  onClose: () => void;
}

function focusables(root: HTMLElement | null): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])];
}

function firstFocusable(root: HTMLElement | null): HTMLElement | undefined {
  return focusables(root)[0];
}

function lastFocusable(root: HTMLElement | null): HTMLElement | undefined {
  const list = focusables(root);
  return list[list.length - 1];
}

function trapTabKey(event: KeyboardEvent, root: HTMLElement | null): void {
  if (event.key !== "Tab") return;
  const first = firstFocusable(root);
  const last = lastFocusable(root);
  if (!first || !last) return;
  const atEdge = event.shiftKey ? document.activeElement === first : document.activeElement === last;
  if (!atEdge) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}

function useFocusTrap(open: boolean, rootRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const onKey = (event: KeyboardEvent) => { trapTabKey(event, root); };
    document.addEventListener("keydown", onKey);
    (firstFocusable(root) ?? root)?.focus();
    return () => { document.removeEventListener("keydown", onKey); };
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
