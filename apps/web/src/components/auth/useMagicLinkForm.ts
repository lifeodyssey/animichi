import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { type MagicLinkResult, sendMagicLink } from "../../lib/auth/neonAuth";
import { sanitizeReturnTarget } from "../../lib/auth/returnTarget";

export type ValidationKey = "email_required" | "email_invalid";
export type FormStatus = "idle" | "submitting" | MagicLinkResult;

/** Structural submit handler: React's synthetic form event satisfies it. */
export type SubmitHandler = (event: { preventDefault: () => void }) => void;

export interface MagicLinkForm {
  email: string;
  status: FormStatus;
  validation: ValidationKey | null;
  setEmail: (email: string) => void;
  onSubmit: SubmitHandler;
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

function useSendMagicLink(email: string, onCommitted: RefObject<SendCommitted | undefined>, returnTarget?: string): [FormStatus, () => Promise<void>] {
  const [status, setStatus] = useState<FormStatus>("idle");
  const submit = useCallback(async () => {
    setStatus("submitting");
    onCommitted.current?.();
    setStatus(await sendMagicLink(requestFor(email, returnTarget)));
  }, [email, onCommitted, returnTarget]);
  return [status, submit];
}

type SetValidation = (validation: ValidationKey | null) => void;

function useSubmit(email: string, setValidation: SetValidation, submit: () => Promise<void>): SubmitHandler {
  return useCallback<SubmitHandler>((event) => {
    event.preventDefault();
    const invalid = validateEmail(email);
    setValidation(invalid);
    if (!invalid) void submit();
  }, [email, setValidation, submit]);
}

export function useMagicLinkForm(onSendCommitted?: SendCommitted, returnTarget?: string): MagicLinkForm {
  const [email, setEmail] = useState("");
  const [validation, setValidation] = useState<ValidationKey | null>(null);
  const [status, submit] = useSendMagicLink(email, useLatest(onSendCommitted), returnTarget);
  const onSubmit = useSubmit(email, setValidation, submit);
  return { email, status, validation, setEmail, onSubmit };
}
