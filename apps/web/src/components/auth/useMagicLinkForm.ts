import { useCallback, useState } from "react";
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

/** `onSent` fires in this continuation, alongside the status commit — never from
 * a passive effect, which would land a tick after the banner is observable and
 * lose a race with an immediate dismissal (issues #437 / #465). */
function useSendMagicLink(email: string, onSent?: () => void): [FormStatus, () => Promise<void>] {
  const [status, setStatus] = useState<FormStatus>("idle");
  const submit = useCallback(async () => {
    setStatus("submitting");
    const result = await sendMagicLink({ email: email.trim().toLowerCase(), callbackURL: callbackUrl() });
    setStatus(result);
    if (result === "sent") onSent?.();
  }, [email, onSent]);
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

export function useMagicLinkForm(onSent?: () => void): MagicLinkForm {
  const [email, setEmail] = useState("");
  const [validation, setValidation] = useState<ValidationKey | null>(null);
  const [status, submit] = useSendMagicLink(email, onSent);
  const onSubmit = useSubmit(email, setValidation, submit);
  return { email, status, validation, setEmail, onSubmit };
}
