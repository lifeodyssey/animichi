import { Button } from "animal-island-ui-tailwind/button";
import { useEffect, useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import type { Dict } from "../../../i18n/dictionaries";
import { useDict } from "../../../i18n/LocaleProvider";
import { LoginForm } from "./LoginForm";
import type { SendCommitted } from "./use-magic-link-form";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onSendCommitted?: SendCommitted;
  returnTarget?: string;
}

const MASK = "login-modal__mask fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-fg/40 p-4";
const PANEL = "login-modal relative my-auto grid w-full max-w-[420px] [max-height:calc(100dvh_-_32px)] overflow-y-auto overscroll-contain rounded-3xl bg-paper p-6 text-left text-fg shadow-[0_24px_72px_-20px_color-mix(in_srgb,var(--color-fg)_45%,transparent)] outline-none";
const CLOSE = "absolute right-3 top-4 [height:40px]! [width:40px]! [min-width:40px]! [padding:0]! [--animal-text-color:var(--color-muted-fg)] focus-visible:outline-primary-strong motion-reduce:transition-none";

function useEscapeToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/** Wrap Tab once within the dialog: advancing past the last field or
 * Shift+Tab before the first loops focus back to the opposite end. */
function wrapFocus(event: KeyboardEvent, root: HTMLElement): void {
  const list = focusables(root);
  const first = list[0];
  const last = list[list.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  if (root.contains(active) && active !== root && active !== (event.shiftKey ? first : last)) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}

function initialFocus(root: HTMLElement): HTMLElement {
  const narrowOrTouch = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse), (max-width: 640px)").matches;
  return narrowOrTouch ? root : root.querySelector<HTMLElement>('input[type="email"]') ?? root;
}

/** Desktop starts at the email; touch and narrow screens avoid opening a keyboard. */
function focusTrapEffect(open: boolean, rootRef: RefObject<HTMLDivElement | null>): () => void {
  const root = open ? rootRef.current : null;
  if (!root) return () => undefined;
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const onKey = (event: KeyboardEvent): void => { if (event.key !== "Tab") return; wrapFocus(event, root); };
  document.addEventListener("keydown", onKey);
  initialFocus(root).focus();
  return () => { document.removeEventListener("keydown", onKey); trigger?.focus(); };
}

/** Tab stays inside the dialog; closing restores the invoking control. */
function useFocusTrap(open: boolean, rootRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => focusTrapEffect(open, rootRef), [open, rootRef]);
}

interface LoginDialogProps {
  auth: Dict["auth"];
  onClose: () => void;
  headingId: string;
  children: ReactNode;
  panelRef: RefObject<HTMLDivElement | null>;
}

function CloseGlyph() {
  return <svg aria-hidden="true" focusable="false" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="m6 6 12 12M6 18 18 6" /></svg>;
}

function LoginDialog({ auth, onClose, children, headingId, panelRef }: LoginDialogProps) {
  return <div className={PANEL} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} ref={panelRef} onClick={(event) => { event.stopPropagation(); }}>
    <Button htmlType="button" type="text" className={CLOSE} aria-label={auth.close} onClick={onClose} icon={<CloseGlyph />} />
    {children}
  </div>;
}

function useDialogScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
}

type FrameProps = Readonly<{ open: boolean; onClose: () => void; headingId: string; children: ReactNode }>;

/** Own focus policy and close control; portaling keeps enclosing cards from clipping the dialog. */
export function LoginModalFrame({ open, onClose, children, headingId }: FrameProps) {
  const auth = useDict().auth, panelRef = useRef<HTMLDivElement>(null);
  useEscapeToClose(open, onClose); useFocusTrap(open, panelRef); useDialogScrollLock(open);
  if (!open || typeof document === "undefined") return null;
  return createPortal(<div className={MASK} role="presentation" onClick={onClose}>
    <LoginDialog auth={auth} onClose={onClose} headingId={headingId} panelRef={panelRef}>{children}</LoginDialog>
  </div>, document.body);
}

export function LoginModal({ open, onClose, onSendCommitted, returnTarget }: LoginModalProps) {
  const headingId = useId();
  return <LoginModalFrame open={open} onClose={onClose} headingId={headingId}>
    <LoginForm headingId={headingId} onSendCommitted={onSendCommitted} returnTarget={returnTarget} />
  </LoginModalFrame>;
}
