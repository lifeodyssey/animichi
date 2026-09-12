import { type SendCommitted, useMagicLinkForm } from "./use-magic-link-form";
import { LoginFormView } from "./LoginFormView";

export interface LoginFormProps {
  /** Announced once the send is dispatched, so a caller can tell "closed to go
   * read the email" from "cancelled" — see `SendCommitted` for the timing. */
  readonly onSendCommitted?: SendCommitted;
  /** Validated post-login destination carried in the mailed link (#284 T8). */
  readonly returnTarget?: string;
  readonly headingId?: string;
}

export function LoginForm({ onSendCommitted, returnTarget, headingId }: LoginFormProps = {}) {
  const form = useMagicLinkForm(onSendCommitted, returnTarget);
  return <LoginFormView form={form} headingId={headingId} />;
}
