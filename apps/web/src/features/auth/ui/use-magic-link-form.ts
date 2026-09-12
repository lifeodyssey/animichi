import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { type MagicLinkRequest, type MagicLinkResult, sendMagicLink } from "../../../lib/auth/neon-auth";
import { sanitizeReturnTarget } from "../../../lib/auth/return-target";

export type ValidationKey = "email_required" | "email_invalid";
export type FormStatus = "idle" | "submitting" | "failed" | MagicLinkResult;

/** Structural submit handler: React's synthetic form event satisfies it. */
export type SubmitHandler = (event: { preventDefault: () => void }) => void;

export interface MagicLinkForm {
  email: string;
  status: FormStatus;
  validation: ValidationKey | null;
  sentEmail: string | null;
  setEmail: (email: string) => void;
  onSubmit: SubmitHandler;
  editEmail: () => void;
}

export function validateEmail(email: string): ValidationKey | null {
  const trimmed = email.trim();
  if (trimmed.length === 0) return "email_required";
  return trimmed.includes("@") ? null : "email_invalid";
}

/**
 * Normative (issue #284 Task 8, spec P2-4): the mailed link's `callbackURL` is
 * ALWAYS `${origin}/auth/callback`, with an already-validated relative `next`
 * appended — never a caller-supplied absolute URL, which would move the open
 * redirect (threat T14) up into the auth provider. A missing, invalid, or
 * home-pointing target elides the parameter entirely.
 */
function callbackUrl(returnTarget?: string): string {
  const base = `${window.location.origin}/auth/callback`;
  const next = sanitizeReturnTarget(returnTarget);
  return next === "/" ? base : `${base}?next=${encodeURIComponent(next)}`;
}

/**
 * Announced once per dispatched request, at the **start** of the send — the
 * user's commitment is the click, not the server's reply. A caller that keys
 * off dismissal (the P5 save wall) must count an in-flight request as
 * committed, or the entire request latency is a window in which closing the
 * modal destroys the intent. Never announced from a passive effect either:
 * that lands a tick after the banner is observable (issues #437 / #465).
 */
export type SendCommitted = () => void;

/** Latest-ref so a caller's inline callback cannot churn `submit`'s identity or
 * be captured stale, mirroring `useTurnTiming`'s `reportRef`. */
function useLatest(callback: SendCommitted | undefined): RefObject<SendCommitted | undefined> {
  const ref = useRef(callback);
  ref.current = callback;
  return ref;
}

function requestFor(email: string, returnTarget?: string) {
  return { email: email.trim().toLowerCase(), callbackURL: callbackUrl(returnTarget) };
}

interface DeliveryState { status: FormStatus; sentEmail: string | null }
interface DeliveryControl {
  busy: RefObject<boolean>; active: RefObject<boolean>;
  committed: RefObject<SendCommitted | undefined>;
  setState: Dispatch<SetStateAction<DeliveryState>>;
}

function useActiveDelivery() {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return active;
}

async function requestLink(request: MagicLinkRequest): Promise<MagicLinkResult | "failed"> {
  try { return await sendMagicLink(request); }
  catch { return "failed"; }
}

function settleLink(control: DeliveryControl, request: MagicLinkRequest, result: MagicLinkResult | "failed") {
  control.busy.current = false;
  if (!control.active.current) return;
  control.setState((previous) => ({ status: result, sentEmail: result === "sent" ? request.email : previous.sentEmail }));
}

async function dispatchLink(control: DeliveryControl, request: MagicLinkRequest): Promise<void> {
  if (control.busy.current || !control.active.current) return;
  control.busy.current = true;
  control.setState((previous) => ({ ...previous, status: "submitting" }));
  control.committed.current?.();
  const result = await requestLink(request);
  settleLink(control, request, result);
}

function useSendMagicLink(email: string, committed: RefObject<SendCommitted | undefined>, returnTarget?: string) {
  const [state, setState] = useState<DeliveryState>({ status: "idle", sentEmail: null });
  const busy = useRef(false), active = useActiveDelivery();
  const submit = () => dispatchLink({ busy, active, setState, committed }, requestFor(email, returnTarget));
  const edit = () => { if (!busy.current) setState({ status: "idle", sentEmail: null }); };
  return { ...state, submit, edit };
}

type SetValidation = (validation: ValidationKey | null) => void;

function useSubmit(email: string, setValidation: SetValidation, submit: () => Promise<void>, busy: boolean): SubmitHandler {
  return useCallback<SubmitHandler>((event) => {
    event.preventDefault();
    if (busy) return;
    const invalid = validateEmail(email);
    setValidation(invalid);
    if (!invalid) void submit();
  }, [email, setValidation, submit, busy]);
}

export function useMagicLinkForm(onSendCommitted?: SendCommitted, returnTarget?: string): MagicLinkForm {
  const [email, setEmail] = useState("");
  const [validation, setValidation] = useState<ValidationKey | null>(null);
  const delivery = useSendMagicLink(email, useLatest(onSendCommitted), returnTarget);
  const onSubmit = useSubmit(email, setValidation, delivery.submit, delivery.status === "submitting");
  const changeEmail = (value: string) => { if (delivery.status === "submitting" || delivery.sentEmail !== null) return; setEmail(value); if (validation) setValidation(validateEmail(value)); };
  return { email, status: delivery.status, sentEmail: delivery.sentEmail, validation, setEmail: changeEmail, onSubmit, editEmail: delivery.edit };
}
