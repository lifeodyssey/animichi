import type { ChangeEvent } from "react";
import { useCallback, useState } from "react";
import { Button } from "animal-island-ui-tailwind/button";
import { Input } from "animal-island-ui-tailwind/input";
import { Radio } from "animal-island-ui-tailwind/radio";
import { LoginModal } from "../../auth/ui/LoginModal";
import type { AuthStatus } from "../../../lib/auth/session";
import { clearByokConfig, getByokConfig } from "../../../lib/byok/byok-storage";
import type { ByokProvider } from "../../../lib/byok/byok-storage";
import { runByokProbe } from "../byok-probe";
import { BYOK_SETUP_TARGET, useLoginDisclosure } from "../byok-journey";
import type { ChatByokDict, ChatDict } from "../i18n";
import { useByokSettings } from "../use-byok-settings";
import type { ByokInlineError, ByokSettingsView } from "../use-byok-settings";

type Props = Readonly<{
  dict: ChatDict;
  auth: AuthStatus;
  baseUrl: string;
  probe?: typeof runByokProbe;
}>;

const PROVIDERS: readonly ByokProvider[] = ["openai-compatible", "anthropic", "gemini"];

function familyLabel(byok: ChatByokDict, provider: ByokProvider): string {
  if (provider === "openai-compatible") return byok.familyOpenaiCompatible;
  return provider === "anthropic" ? byok.familyAnthropic : byok.familyGemini;
}

const ERROR_COPY: Readonly<Record<ByokInlineError, keyof ChatByokDict>> = {
  key_required: "apiKeyRequired",
  key_invalid: "apiKeyInvalid",
  model_required: "modelRequired",
  base_url_invalid: "baseUrlInvalid",
  credential_rejected: "notAccepted",
  unreachable: "errorUnreachable",
  egress_blocked: "errorEgressBlocked",
  invalid_request: "errorInvalidRequest",
  requires_login: "errorRequiresLogin",
  probe_failed: "errorUnreachable",
};

type PanelProps = Readonly<{ byok: ChatByokDict; view: ByokSettingsView }>;

function isProvider(value: string | number): value is ByokProvider {
  return typeof value === "string" && PROVIDERS.includes(value as ByokProvider);
}

function ProviderGroup({ byok, view }: PanelProps) {
  const options = PROVIDERS.map((provider) => ({ value: provider, label: familyLabel(byok, provider) }));
  const choose = (value: string | number) => { if (isProvider(value)) view.setProvider(value); };
  return (
    <div className="settings-byok__field">
      <span id="byok-provider-label" className="settings-byok__label">{byok.familyLabel}</span>
      <Radio value={view.form.provider} options={options} direction="vertical" aria-labelledby="byok-provider-label" onChange={choose} />
    </div>
  );
}

type FieldProps = Readonly<{
  id: string;
  label: string;
  value: string;
  type?: string;
  help?: string;
  onValue: (value: string) => void;
}>;

function FieldHelp({ id, help }: Readonly<{ id: string; help?: string }>) {
  if (help === undefined) return null;
  return <p id={`${id}-help`} className="settings-byok__help">{help}</p>;
}

function Field({ id, label, value, type = "text", help, onValue }: FieldProps) {
  const onChange = (event: ChangeEvent<HTMLInputElement>) => { onValue(event.target.value); };
  const helpId = help === undefined ? undefined : `${id}-help`;
  return <div className="settings-byok__field">
    <label className="settings-byok__label" htmlFor={id}>{label}</label>
    <Input id={id} type={type} value={value} autoComplete="off" aria-describedby={helpId} shadow onChange={onChange} />
    <FieldHelp id={id} help={help} />
  </div>;
}

/** base_url belongs to the openai-compatible family only (wire contract). */
function BaseUrlField({ byok, view }: PanelProps) {
  if (view.form.provider !== "openai-compatible") return null;
  return (
    <Field id="byok-base-url" label={byok.baseUrlLabel} value={view.form.baseUrl} help={byok.baseUrlHelp} onValue={view.setBaseUrl} />
  );
}

/** The inline error region (T6-AC6): failures render here, inside the panel,
 * never as a generic chat failure banner. */
function InlineError({ byok, view }: PanelProps) {
  if (view.error === null) return null;
  return <p className="settings-byok__error" role="alert">{byok[ERROR_COPY[view.error]]}</p>;
}

function VisionBadge({ byok, view }: PanelProps) {
  if (view.vision !== true) return null;
  return <span className="settings-byok__badge">{byok.visionBadge}</span>;
}

/** Masked summary only — the raw key is never rendered back into the DOM. */
function SavedSummary({ byok, view }: PanelProps) {
  if (!view.saved) return null;
  return (
    <div className="settings-byok__summary">
      <span>{byok.maskedSummary}</span>
      <VisionBadge byok={byok} view={view} />
      <Button type="text" className="settings-byok__clear" onClick={view.clear}>{byok.clear}</Button>
    </div>
  );
}

function StatusLine({ byok, view }: PanelProps) {
  if (view.phase !== "checking") return null;
  return <p className="settings-byok__status" role="status">{byok.checking}</p>;
}

function CredentialFields({ byok, view }: PanelProps) {
  return (
    <>
      <Field id="byok-api-key" label={byok.apiKeyLabel} value={view.form.apiKey} type="password" onValue={view.setApiKey} />
      <Field id="byok-model" label={byok.modelLabel} value={view.form.model} onValue={view.setModel} />
      <BaseUrlField byok={byok} view={view} />
    </>
  );
}

function FormFeedback({ byok, view }: PanelProps) {
  return (
    <>
      <InlineError byok={byok} view={view} />
      <StatusLine byok={byok} view={view} />
    </>
  );
}

function FormBody({ byok, view }: PanelProps) {
  return (
    <>
      <ProviderGroup byok={byok} view={view} />
      <CredentialFields byok={byok} view={view} />
      <FormFeedback byok={byok} view={view} />
      <Button htmlType="submit" type="primary" className="settings-byok__save" disabled={view.phase === "checking"}>{byok.save}</Button>
    </>
  );
}

function makeSaveSubmit(view: ByokSettingsView) {
  return (event: { preventDefault: () => void }) => {
    event.preventDefault();
    view.save();
  };
}

function SettingsForm({ byok, view }: PanelProps) {
  return (
    <form className="settings-byok__form" onSubmit={makeSaveSubmit(view)} noValidate>
      <FormBody byok={byok} view={view} />
    </form>
  );
}

/**
 * P1-1 (#480 review): a signed-out visitor whose session lapsed may still hold
 * a stored credential — which `byokHeaders()` keeps attaching to every turn,
 * earning `byok_requires_login`. The teaser is their only surface, so it MUST
 * offer deletion; login is never the price of removing your own key.
 */
function useStoredKey() {
  const [stored, setStored] = useState(() => getByokConfig() !== null);
  const clear = useCallback(() => {
    clearByokConfig();
    setStored(false);
  }, []);
  return { stored, clear };
}

function StoredKeyNotice({ byok }: Readonly<{ byok: ChatByokDict }>) {
  const key = useStoredKey();
  if (!key.stored) return null;
  return (
    <div className="settings-byok__summary">
      <span>{byok.maskedSummary}</span>
      <Button type="text" className="settings-byok__clear" onClick={key.clear}>{byok.clear}</Button>
    </div>
  );
}

/** T8 touchpoint B: the anonymous teaser renders NO key input at all — there
 * is no field that would silently discard input — only the value proposition,
 * a login CTA whose mailed link deep-links back to this panel, and (P1-1) a
 * clear entry for a credential left behind by a lapsed session. */
function TeaserLogin({ byok }: Readonly<{ byok: ChatByokDict }>) {
  const login = useLoginDisclosure();
  return (
    <>
      <Button type="primary" className="settings-byok__signin" onClick={login.show}>{byok.signInToSetUp}</Button>
      <LoginModal open={login.open} onClose={login.hide} returnTarget={BYOK_SETUP_TARGET} />
    </>
  );
}

function AnonymousTeaser({ byok }: Readonly<{ byok: ChatByokDict }>) {
  return (
    <div className="settings-byok__teaser">
      <StoredKeyNotice byok={byok} />
      <p>{byok.anonymousTeaser}</p>
      <TeaserLogin byok={byok} />
    </div>
  );
}

function PanelBody({ dict, auth, baseUrl, probe }: Props) {
  if (auth === "pending") return <p className="settings-byok__status" role="status">{dict.byok.authPending}</p>;
  if (auth === "anonymous") return <AnonymousTeaser byok={dict.byok} />;
  return <AuthenticatedPanel dict={dict} baseUrl={baseUrl} probe={probe} />;
}

function AuthenticatedPanel({ dict, baseUrl, probe = runByokProbe }: Omit<Props, "auth">) {
  const view = useByokSettings(baseUrl, probe);
  return (
    <>
      <SavedSummary byok={dict.byok} view={view} />
      <SettingsForm byok={dict.byok} view={view} />
    </>
  );
}

/** BYOK controls for the dedicated settings page (issue #284 Task 6 + Task 8). */
export function ByokSettings(panel: Props) {
  return (
    <div className="settings-byok">
      <PanelBody {...panel} />
    </div>
  );
}
