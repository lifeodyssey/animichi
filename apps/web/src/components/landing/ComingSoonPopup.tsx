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

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/** An empty dialog leaves `wrap` undefined and Tab passes through untouched. */
function trapTabKey(event: KeyboardEvent, root: HTMLElement): void {
  if (event.key !== "Tab") return;
  const list = focusables(root);
  const forward = !event.shiftKey;
  const edge = forward ? list[list.length - 1] : list[0];
  const wrap = forward ? list[0] : list[list.length - 1];
  if (wrap === undefined || document.activeElement !== edge) return;
  event.preventDefault();
  wrap.focus();
}

/** Initial focus lands on the dialog container (WAI-ARIA modal pattern; it has tabIndex=-1). */
function useFocusTrap(open: boolean, rootRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const root = open ? rootRef.current : null;
    if (!root) return;
    const onKey = (event: KeyboardEvent) => { trapTabKey(event, root); };
    document.addEventListener("keydown", onKey);
    root.focus();
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
