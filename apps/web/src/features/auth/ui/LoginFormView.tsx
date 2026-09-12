import { Button } from "animal-island-ui-tailwind/button";
import { Input } from "animal-island-ui-tailwind/input";
import { useEffect, useId, useRef } from "react";
import type { RefObject } from "react";
import type { Dict } from "../../../i18n/dictionaries";
import { useDict } from "../../../i18n/LocaleProvider";
import type { MagicLinkForm } from "./use-magic-link-form";

type Auth = Dict["auth"];
type Props = Readonly<{ form: MagicLinkForm; headingId?: string }>;
const INPUT = "[width:100%] [min-height:50px]! [border-radius:14px]! [--animal-text-color:var(--color-fg)] [--animal-primary-color:var(--color-primary-strong)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-strong [&_input]:[font-size:16px]! [&_input]:min-w-0";
const ACTION = "[height:auto]! [min-height:46px]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! focus-visible:outline-primary-strong motion-reduce:transition-none";
const GOLD = "[width:100%]! [padding:13px_18px]! [--animal-bg-color:var(--color-gold)] [--animal-text-color:var(--color-gold-ink)]";

function feedbackFor(auth: Auth, form: MagicLinkForm): string | null {
  if (form.validation) return auth[form.validation];
  if (form.status === "not_configured") return auth.not_configured;
  if (form.status === "failed") return auth.send_failed;
  return typeof form.status === "object" ? form.status.error : null;
}

function FormHeading({ form, headingId, headingRef }: Props & Readonly<{ headingRef: RefObject<HTMLHeadingElement | null> }>) {
  const auth = useDict().auth, sent = form.sentEmail !== null;
  return <header className="grid gap-2 pr-9">
    <h2 ref={headingRef} id={headingId} tabIndex={-1} className="text-2xl font-bold leading-9 text-fg outline-none">{sent ? auth.sent_title : auth.title}</h2>
    <p className="text-sm leading-6 text-muted-fg">{sent ? auth.sent : auth.subtitle}</p>
  </header>;
}

type FieldProps = Props & Readonly<{ emailRef: RefObject<HTMLInputElement | null>; feedbackId: string }>;

function SentEmail({ email }: Readonly<{ email: string }>) {
  const auth = useDict().auth;
  return <div className="grid min-w-0 gap-2"><p className="text-sm leading-5 text-muted-fg">{auth.sent_to}</p><p className="rounded-xl bg-primary-soft px-4 py-3 text-base font-semibold leading-7 text-primary-ink [overflow-wrap:anywhere]">{email}</p></div>;
}

function EmailField({ form, emailRef, feedbackId }: FieldProps) {
  const auth = useDict().auth, id = useId();
  if (form.sentEmail !== null) return <SentEmail email={form.sentEmail} />;
  return <div className="grid min-w-0 gap-2">
    <label htmlFor={id} className="text-sm font-semibold leading-5 text-fg">{auth.email_label}</label>
    <Input ref={emailRef} id={id} className={INPUT} type="email" name="email" autoComplete="email" inputMode="email" spellCheck={false} enterKeyHint="send" value={form.email} readOnly={form.status === "submitting"} aria-invalid={form.validation !== null} aria-describedby={form.validation ? feedbackId : undefined} status={form.validation ? "error" : undefined} placeholder={auth.email_placeholder} onChange={(event) => { form.setEmail(event.target.value); }} />
  </div>;
}

function SentActions({ form }: Props) {
  const auth = useDict().auth, busy = form.status === "submitting";
  return <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
    <Button htmlType="submit" type="default" className={`${ACTION} [padding:10px_16px]! [--animal-text-color:var(--color-fg)]`} disabled={busy} aria-busy={busy}>{busy ? auth.resending : auth.resend}</Button>
    <Button htmlType="button" type="text" className={`${ACTION} [padding:10px_4px]! [--animal-text-color:var(--color-primary-strong)]`} disabled={busy} onClick={form.editEmail}>{auth.change_email}</Button>
  </div>;
}

function FormActions({ form }: Props) {
  const auth = useDict().auth, busy = form.status === "submitting";
  if (form.sentEmail !== null) return <SentActions form={form} />;
  return <Button htmlType="submit" type="primary" className={`${ACTION} ${GOLD}`} disabled={busy} aria-busy={busy}>{busy ? auth.submitting : auth.submit}</Button>;
}

function DeliveryStatus({ form }: Props) {
  const auth = useDict().auth;
  if (form.status !== "sent") return null;
  return <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">{auth.sent}</span>;
}

function useDeliveryFocus(sentEmail: string | null) {
  const emailRef = useRef<HTMLInputElement>(null), headingRef = useRef<HTMLHeadingElement>(null), previous = useRef(sentEmail);
  useEffect(() => {
    if (previous.current === sentEmail) return;
    (sentEmail === null ? emailRef.current : headingRef.current)?.focus();
    previous.current = sentEmail;
  }, [sentEmail]);
  return { emailRef, headingRef };
}

/** Controlled presentation lets Storybook show delivery phases without sending email. */
export function LoginFormView(props: Props) {
  const auth = useDict().auth, { emailRef, headingRef } = useDeliveryFocus(props.form.sentEmail), feedbackId = useId(), feedback = feedbackFor(auth, props.form);
  return <form className="login-form grid min-w-0 gap-5 text-left" onSubmit={props.form.onSubmit} noValidate aria-label={auth.title}>
    <FormHeading {...props} headingRef={headingRef} /><EmailField {...props} emailRef={emailRef} feedbackId={feedbackId} />
    {feedback ? <p id={feedbackId} role="alert" className="text-sm leading-6 text-error-strong [overflow-wrap:anywhere]">{feedback}</p> : null}
    <FormActions form={props.form} />
    <p className="text-sm leading-6 text-muted-fg">{props.form.sentEmail !== null ? auth.sent_hint : auth.magic_link_hint}</p>
    <DeliveryStatus {...props} />
  </form>;
}
