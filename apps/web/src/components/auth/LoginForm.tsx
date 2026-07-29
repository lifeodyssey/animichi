import type { ChangeEvent } from "react";
import type { Dict } from "../../i18n/dictionaries";
import { useDict } from "../../i18n/context";
import { type FormStatus, type MagicLinkForm, type SendCommitted, type ValidationKey, useMagicLinkForm } from "./useMagicLinkForm";

type Auth = Dict["auth"];

interface Feedback {
  tone: "error" | "status";
  text: string;
}

function feedbackFor(auth: Auth, status: FormStatus, validation: ValidationKey | null): Feedback | null {
  if (validation) return { tone: "error", text: auth[validation] };
  if (status === "sent") return { tone: "status", text: auth.sent };
  if (status === "error") return { tone: "error", text: auth.error };
  if (status === "not_configured") return { tone: "error", text: auth.not_configured };
  return null;
}

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  const role = feedback.tone === "error" ? "alert" : "status";
  return <p className="login-form__feedback" role={role}>{feedback.text}</p>;
}

interface EmailFieldProps {
  auth: Auth;
  email: string;
  onEmail: (value: string) => void;
}

function EmailField({ auth, email, onEmail }: EmailFieldProps) {
  const onChange = (event: ChangeEvent<HTMLInputElement>) => { onEmail(event.target.value); };
  return (
    <>
      <label className="login-form__label" htmlFor="login-email">{auth.email_label}</label>
      <input id="login-email" className="ds-input" type="email" value={email} placeholder={auth.email_placeholder} onChange={onChange} />
    </>
  );
}

function SubmitButton({ auth, busy }: { auth: Auth; busy: boolean }) {
  return (
    <button className="ds-button ds-button--primary" type="submit" disabled={busy}>
      {busy ? auth.submitting : auth.submit}
    </button>
  );
}

function FormFields({ form }: { form: MagicLinkForm }) {
  const auth = useDict().auth;
  const feedback = feedbackFor(auth, form.status, form.validation);
  return (<>
    <EmailField auth={auth} email={form.email} onEmail={form.setEmail} />
    {feedback ? <FeedbackLine feedback={feedback} /> : null}
    <SubmitButton auth={auth} busy={form.status === "submitting"} />
    <p className="login-form__hint">{auth.magic_link_hint}</p>
  </>);
}

export interface LoginFormProps {
  /** Announced once the send is dispatched, so a caller can tell "closed to go
   * read the email" from "cancelled" — see `SendCommitted` for the timing. */
  readonly onSendCommitted?: SendCommitted;
}

export function LoginForm({ onSendCommitted }: LoginFormProps = {}) {
  const form = useMagicLinkForm(onSendCommitted);
  const auth = useDict().auth;
  return (
    <form className="login-form" onSubmit={form.onSubmit} noValidate aria-label={auth.title}>
      <FormFields form={form} />
    </form>
  );
}
