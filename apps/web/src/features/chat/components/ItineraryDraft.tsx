import { Button } from "animal-island-ui-tailwind/button";
import { useId } from "react";
import type { ReactNode, RefObject } from "react";
import type { ChatDict } from "../i18n";
import type { DraftRevision, ItineraryDraftPlan } from "../lib/itinerary-draft";
import { draftPlaceCount, itineraryDraftCopy } from "../itinerary-draft-copy";
import { DraftStopList } from "./DraftStopList";
import type { DraftPlaceControls } from "./DraftPlaceControls";
import { DraftSaveActions } from "./DraftSaveActions";
import type { DraftSaveState } from "./DraftSaveActions";

export interface ItineraryDraftProps {
  readonly draft: ItineraryDraftPlan;
  readonly dict: ChatDict;
  readonly revision?: DraftRevision;
  readonly saveState?: DraftSaveState;
  readonly onSave: (draftId: string) => void;
  readonly onAdjust: (draftId: string) => void;
}

type ContentProps = Pick<ItineraryDraftProps, "draft" | "dict">;
const ACTION = "[min-height:48px]! [height:auto]! [padding:10px_16px]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";
const QUIET = "[--animal-text-color:var(--color-fg)] [--animal-bg-color-secondary:var(--color-primary-soft)]";

function DraftConditions({ draft, dict }: ContentProps) {
  const copy = itineraryDraftCopy(dict.locale);
  const fields = [{ name: copy.origin, value: draft.conditions.origin.trim() ? copy.from.replace("{place}", draft.conditions.origin) : "" }, { name: copy.availableTime, value: draft.conditions.availableTime }, { name: copy.departureTime, value: draft.conditions.departureTime }].filter((field) => field.value.trim());
  if (fields.length === 0) return null;
  return <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 text-sm leading-6 text-muted-fg">{fields.map((field) => <div key={field.name} className="flex min-w-0 items-baseline gap-3 not-first:before:content-['·']"><dt className="sr-only">{field.name}</dt><dd className="[overflow-wrap:anywhere]">{field.value}</dd></div>)}</dl>;
}

function DraftHeader({ draft, dict, titleId, headingRef }: ContentProps & Readonly<{ titleId: string; headingRef?: RefObject<HTMLHeadingElement | null> }>) {
  const copy = itineraryDraftCopy(dict.locale);
  return <header className="grid gap-2.5">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5"><span className="font-bold tracking-wide text-primary-strong">{copy.draft}</span><span className="text-muted-fg">{draftPlaceCount(dict.locale, draft.stops.length)}</span></div>
    <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-[22px] font-bold leading-8 tracking-[-0.025em] [overflow-wrap:anywhere] outline-primary-strong">{draft.title}</h2>
    <DraftConditions draft={draft} dict={dict} />
    {draft.introduction?.trim() ? <p className="pt-1 text-sm leading-7 text-muted-fg [overflow-wrap:anywhere] [text-wrap:pretty]">{draft.introduction}</p> : null}
  </header>;
}

function DraftAssumptions({ draft, dict }: ContentProps) {
  const assumptions = draft.assumptions.filter((item) => item.trim());
  if (assumptions.length === 0) return null;
  return <aside className="grid gap-1.5 border-l-2 border-border-soft pl-3 text-sm leading-6 text-muted-fg" aria-label={itineraryDraftCopy(dict.locale).assumptions}>
    <p className="font-bold">{itineraryDraftCopy(dict.locale).assumptions}</p>
    <ul className="grid gap-1">{assumptions.map((item, index) => <li key={`${String(index)}:${item}`} className="[overflow-wrap:anywhere]">{item}</li>)}</ul>
  </aside>;
}

function RevisionFeedback({ revision, dict }: Pick<ItineraryDraftProps, "revision" | "dict">) {
  const copy = itineraryDraftCopy(dict.locale);
  if (!revision) return null;
  if (revision.state === "updating") return <p role="status" className="text-sm leading-6 text-muted-fg">{copy.updating}</p>;
  return <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><p role="status" className="min-w-0 flex-1 text-sm leading-6 text-muted-fg">{copy.failed}</p><Button type="text" htmlType="button" className={`${ACTION} ${QUIET}`} onClick={revision.onRetry}>{copy.retry}</Button></div>;
}

function DraftFooter({ draft, dict, revision, saveState, onSave, onAdjust }: ItineraryDraftProps) {
  const copy = itineraryDraftCopy(dict.locale);
  return <footer className="grid gap-3">
    <p className="text-xs leading-5 text-muted-fg">{copy.note}</p>
    <DraftSaveActions draftId={draft.id} dict={dict} state={saveState} onSave={onSave} onAdjust={onAdjust} adjustDisabled={revision?.state === "updating"} />
  </footer>;
}

function EmptyDraft({ dict, draft, onAdjust }: ItineraryDraftProps) {
  const copy = itineraryDraftCopy(dict.locale);
  return <div className="grid justify-items-start gap-3 py-4"><p className="text-base font-bold">{copy.empty}</p><p className="text-sm leading-6 text-muted-fg">{copy.emptyBody}</p><Button type="text" htmlType="button" className={`${ACTION} ${QUIET}`} onClick={() => { onAdjust(draft.id); }}>{copy.adjust}</Button></div>;
}

type DocumentProps = ContentProps & Readonly<{ children?: ReactNode; footer?: ReactNode; feedback?: ReactNode; controls?: DraftPlaceControls; headingRef?: RefObject<HTMLHeadingElement | null> }>;

/** Read and edit share one itinerary document; callers supply the appropriate footer. */
export function ItineraryDraftDocument(props: DocumentProps) {
  const titleId = useId();
  return <section aria-labelledby={titleId} className="@container/draft flex min-h-0 w-full [max-height:calc(100dvh-80px)] flex-col text-fg">
    <div data-draft-scroll className="relative grid min-h-0 gap-5 overflow-y-auto overscroll-contain scroll-py-4 py-1 pr-1 [scrollbar-gutter:stable]"><DraftHeader {...props} titleId={titleId} />{props.feedback}
      {props.draft.stops.length ? <><DraftStopList stops={props.draft.stops} dict={props.dict} controls={props.controls} /><DraftAssumptions {...props} /></> : null}{props.children}
    </div>{props.footer ? <div className="z-20 shrink-0 border-t border-border-soft bg-paper pt-3">{props.footer}</div> : null}
  </section>;
}

/** Save/adjust emit the visible draft's id; the owner handles transport. */
export function ItineraryDraft(props: ItineraryDraftProps) {
  return <ItineraryDraftDocument {...props} feedback={<RevisionFeedback {...props} />} footer={props.draft.stops.length ? <DraftFooter {...props} /> : undefined}>{props.draft.stops.length ? null : <EmptyDraft {...props} />}</ItineraryDraftDocument>;
}
