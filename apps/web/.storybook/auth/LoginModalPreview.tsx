import { Button } from "animal-island-ui-tailwind/button";
import { useId, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useDict } from "../../src/i18n/LocaleProvider";
import { LoginModal, LoginModalFrame } from "../../src/features/auth/ui/LoginModal";
import { LoginFormView } from "../../src/features/auth/ui/LoginFormView";
import { validateEmail } from "../../src/features/auth/ui/use-magic-link-form";
import type { FormStatus, MagicLinkForm, SubmitHandler, ValidationKey } from "../../src/features/auth/ui/use-magic-link-form";

type Phase = "ready" | "sending" | "sent" | "resending" | "failed" | "resend-failed" | "unavailable";
export type LoginModalPreviewProps = Readonly<{
  phase: Phase; email?: string; startOpen?: boolean;
  onSend: (email: string) => void; onClose: () => void; onSendCommitted: () => void;
}>;
interface Fixture { email: string; phase: Phase; validation: ValidationKey | null }
const STATUS: Readonly<Record<Phase, FormStatus>> = { ready: "idle", sending: "submitting", sent: "sent", resending: "submitting", failed: "failed", "resend-failed": "failed", unavailable: "not_configured" };

function hasSent(phase: Phase) {
  return phase === "sent" || phase === "resending" || phase === "resend-failed";
}

function submitPreview(event: Parameters<SubmitHandler>[0], state: Fixture, setState: Dispatch<SetStateAction<Fixture>>, onSend: LoginModalPreviewProps["onSend"]) {
  event.preventDefault();
  if (STATUS[state.phase] === "submitting") return;
  const validation = validateEmail(state.email);
  if (validation) { setState({ ...state, validation }); return; }
  onSend(state.email.trim().toLowerCase());
  setState({ ...state, phase: hasSent(state.phase) ? "resending" : "sending", validation: null });
}

function useFixtureForm(props: LoginModalPreviewProps): MagicLinkForm {
  const [state, setState] = useState<Fixture>({ phase: props.phase, email: props.email ?? "", validation: null });
  return {
    email: state.email, status: STATUS[state.phase], validation: state.validation, sentEmail: hasSent(state.phase) ? state.email.trim().toLowerCase() : null,
    setEmail: (email) => { setState({ ...state, email, validation: state.validation ? validateEmail(email) : null }); },
    onSubmit: (event) => { submitPreview(event, state, setState, props.onSend); },
    editEmail: () => { setState({ ...state, phase: "ready", validation: null }); },
  };
}

function FixtureForm(props: LoginModalPreviewProps & Readonly<{ headingId: string }>) {
  return <LoginFormView form={useFixtureForm(props)} headingId={props.headingId} />;
}

function LoginTrigger({ onOpen }: Readonly<{ onOpen: () => void }>) {
  const auth = useDict().auth;
  return <div className="grid min-h-[100dvh] place-items-center bg-paper p-6"><Button htmlType="button" type="default" onClick={onOpen}>{auth.title}</Button></div>;
}

export function LoginModalPreview(props: LoginModalPreviewProps) {
  const [open, setOpen] = useState(props.startOpen ?? true), headingId = useId();
  const close = () => { setOpen(false); props.onClose(); };
  return <><LoginTrigger onOpen={() => { setOpen(true); }} /><LoginModalFrame open={open} onClose={close} headingId={headingId}><FixtureForm {...props} headingId={headingId} /></LoginModalFrame></>;
}

/** The real request path hits only Storybook's existing not-configured stub. */
export function LiveLoginPreview(props: LoginModalPreviewProps) {
  const [open, setOpen] = useState(props.startOpen ?? true);
  const close = () => { setOpen(false); props.onClose(); };
  return <><LoginTrigger onOpen={() => { setOpen(true); }} /><LoginModal open={open} onClose={close} onSendCommitted={props.onSendCommitted} returnTarget="/chat?session=storybook" /></>;
}
