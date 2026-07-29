import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { type MagicLinkResult, sendMagicLink } from "../../lib/auth/neonAuth";

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

function callbackUrl(): string {
  return `${window.location.origin}/auth/callback`;
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

function useSendMagicLink(email: string, onCommitted: RefObject<SendCommitted | undefined>): [FormStatus, () => Promise<void>] {
  const [status, setStatus] = useState<FormStatus>("idle");
  const submit = useCallback(async () => {
    setStatus("submitting");
    onCommitted.current?.();
    setStatus(await sendMagicLink({ email: email.trim().toLowerCase(), callbackURL: callbackUrl() }));
  }, [email, onCommitted]);
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

export function useMagicLinkForm(onSendCommitted?: SendCommitted): MagicLinkForm {
  const [email, setEmail] = useState("");
  const [validation, setValidation] = useState<ValidationKey | null>(null);
  const [status, submit] = useSendMagicLink(email, useLatest(onSendCommitted));
  const onSubmit = useSubmit(email, setValidation, submit);
  return { email, status, validation, setEmail, onSubmit };
}
