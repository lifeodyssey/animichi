import { Button } from "animal-island-ui-tailwind/button";
import type { ChatDict } from "../i18n";
import { draftSaveCopy } from "../draft-save-copy";

/** The owner supplies auth and persistence outcomes for a specific immutable draft version. */
export type DraftSaveState = Readonly<{ draftId: string }> & (
  | Readonly<{ status: "idle" | "checking" | "saving" | "retryable" | "permanent" }>
  | Readonly<{ status: "login-required"; onLogin: (draftId: string) => void }>
  | Readonly<{ status: "saved"; savedId: string; onView: (savedId: string) => void }>
);

export interface DraftSaveActionsProps {
  readonly draftId: string;
  readonly dict: ChatDict;
  readonly state?: DraftSaveState;
  readonly onSave: (draftId: string) => void;
  readonly onAdjust: (draftId: string) => void;
  readonly adjustDisabled?: boolean;
}

type ResolvedProps = DraftSaveActionsProps & Readonly<{ state: DraftSaveState }>;
const ACTION = "[min-height:48px]! [height:auto]! [padding:10px_14px]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";
const GOLD = "[--animal-bg-color:var(--color-gold)] [--animal-text-color:var(--color-gold-ink)]";
const SAVED = "[--animal-bg-color:var(--color-primary-soft)] [--animal-text-color:var(--color-primary-ink)] [--animal-primary-color:var(--color-primary-strong)] [--animal-border-color:var(--color-border-soft)]";
const QUIET = "[--animal-text-color:var(--color-fg)] [--animal-bg-color-secondary:var(--color-primary-soft)]";

function saveLocked(state: DraftSaveState) {
  return state.status === "checking" || state.status === "saving" || state.status === "permanent";
}

function activateSave({ draftId, state, onSave }: ResolvedProps) {
  if (saveLocked(state)) return;
  if (state.status === "saved") { state.onView(state.savedId); return; }
  if (state.status === "login-required") { state.onLogin(draftId); return; }
  onSave(draftId);
}

function SaveIcon({ saved }: Readonly<{ saved: boolean }>) {
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={saved ? "M5 12h14m-6-6 6 6-6 6" : "M6 4h12v17l-6-4-6 4z"} /></svg>;
}

function PrimarySave(props: ResolvedProps) {
  const copy = draftSaveCopy(props.dict.locale), status = props.state.status, saved = status === "saved";
  const labels = { idle: copy.save, checking: copy.checking, "login-required": copy.login, saving: copy.saving, saved: copy.view, retryable: copy.retry, permanent: copy.unavailable };
  return <Button type={saved ? "default" : "primary"} htmlType="button" className={`${ACTION} ${saved ? SAVED : GOLD}`} disabled={saveLocked(props.state)} aria-busy={status === "saving" || status === "checking"} aria-label={saved ? copy.viewLabel : labels[status]} onClick={() => { activateSave(props); }}>
    <span className="flex items-center justify-center gap-2">{status === "idle" ? <SaveIcon saved={false} /> : null}{labels[status]}{saved ? <SaveIcon saved /> : null}</span>
  </Button>;
}

function SavedFeedback({ dict }: Pick<ResolvedProps, "dict">) {
  const copy = draftSaveCopy(dict.locale);
  return <div role="status" aria-atomic="true" className="flex items-start gap-2.5 pb-1"><span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-strong"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg></span><div className="grid min-w-0 gap-0.5"><p className="text-sm font-bold leading-6 text-primary-strong">{copy.saved}</p><p className="text-xs leading-5 text-muted-fg">{copy.savedHint}</p></div></div>;
}

function SaveFeedback({ state, dict }: ResolvedProps) {
  const copy = draftSaveCopy(dict.locale), status = state.status;
  if (status === "idle") return null;
  if (status === "saved") return <SavedFeedback dict={dict} />;
  const messages = { checking: copy.checkingHint, "login-required": copy.loginHint, saving: copy.savingHint, retryable: copy.retryHint, permanent: copy.permanentHint };
  const failed = status === "retryable" || status === "permanent";
  return <p role={failed ? "alert" : "status"} className={`text-sm leading-6 text-muted-fg [overflow-wrap:anywhere] ${failed ? "border-l-2 border-gold pl-3" : ""}`}>{messages[status]}</p>;
}

/** Controlled UI: clicks request actions; only a matching owner-supplied outcome can say "saved". */
export function DraftSaveActions(props: DraftSaveActionsProps) {
  const state: DraftSaveState = props.state?.draftId === props.draftId ? props.state : { draftId: props.draftId, status: "idle" };
  const resolved = { ...props, state }, copy = draftSaveCopy(props.dict.locale);
  return <div role="group" aria-label={copy.region} className="grid gap-3"><SaveFeedback {...resolved} /><div className="flex flex-wrap items-center gap-2 pb-1"><PrimarySave {...resolved} />
    <Button type="text" htmlType="button" className={`${ACTION} ${QUIET}`} disabled={(props.adjustDisabled ?? false) || state.status === "saving"} onClick={() => { props.onAdjust(props.draftId); }}>{copy.adjust}</Button>
  </div></div>;
}
