import { Button } from "animal-island-ui-tailwind/button";
import { useId, useState } from "react";
import type { SubmitEvent } from "react";
import type { ChatDict } from "../i18n";
import { cleanTravelConditions, hasPlanningBasics } from "../lib/trip-conditions";
import type { TravelConditions } from "../lib/trip-conditions";
import { tripConditionsCopy } from "../trip-conditions-copy";
import type { TripConditionsCopy } from "../trip-conditions-copy";
import { CONDITION_ACTION, TripConditionField } from "./TripConditionField";
import { SceneIcon } from "./SceneIcon";

export interface TripConditionsProps {
  readonly dict: ChatDict;
  readonly value: TravelConditions;
  readonly busy?: boolean;
  readonly onChange: (value: TravelConditions) => void;
  readonly onContinue: (value: TravelConditions) => void;
}

type FieldsProps = TripConditionsProps & Readonly<{ copy: TripConditionsCopy }>;
const CONTINUE = "[min-height:48px]! [height:auto]! [padding:10px_20px]! [font-size:15px]! [line-height:1.5]! [white-space:normal]! [--animal-bg-color:var(--color-gold)] [--animal-text-color:var(--color-gold-ink)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";

function MainConditions({ value, busy, copy, onChange }: FieldsProps) {
  return <div className="grid gap-5">
    <TripConditionField label={copy.origin} placeholder={copy.originPlaceholder} value={value.origin} editLabel={copy.edit} disabled={busy} onChange={(origin) => { onChange({ ...value, origin }); }} />
    <TripConditionField label={copy.availableTime} placeholder={copy.availableTimePlaceholder} value={value.availableTime} editLabel={copy.edit} disabled={busy} presets={[copy.halfDay, copy.fullDay]} customLabel={copy.custom} onChange={(availableTime) => { onChange({ ...value, availableTime }); }} />
  </div>;
}

function DepartureTime({ value, busy, copy, onChange }: FieldsProps) {
  const [expanded, setExpanded] = useState(() => Boolean(value.departureTime.trim()));
  if (value.departureTime.trim() || expanded) return <TripConditionField label={copy.departureTime} placeholder={copy.departureTimePlaceholder} value={value.departureTime} editLabel={copy.edit} disabled={busy} focusOnOpen={expanded} onChange={(departureTime) => { onChange({ ...value, departureTime }); }} />;
  return <Button type="text" htmlType="button" disabled={busy} className={`${CONDITION_ACTION} justify-self-start [padding-left:0px]!`} aria-expanded={false} onClick={() => { setExpanded(true); }}><span className="flex items-center gap-2"><span aria-hidden="true" className="text-xl font-normal">+</span>{copy.addTime}</span></Button>;
}

function ContinueSuggestion({ value, busy, copy }: FieldsProps) {
  const label = hasPlanningBasics(value) ? copy.continue : copy.draft;
  return <Button type="primary" htmlType="submit" disabled={busy} aria-busy={busy} className={CONTINUE}>
    <span className="grid [grid-template-areas:'action']">
      <span className="[grid-area:action] [visibility:visible] data-[busy=true]:[visibility:hidden]" aria-hidden={busy} data-busy={Boolean(busy)}><span className="flex items-center justify-center gap-3">{label}<span className="shrink-0 [&_svg]:size-4"><SceneIcon name="next" /></span></span></span>
      <span className="[grid-area:action] [visibility:hidden] data-[busy=true]:[visibility:visible]" aria-hidden={!busy} data-busy={Boolean(busy)}>{copy.busy}</span>
    </span>
  </Button>;
}

/** Isolated conditions UI. Mount with the current conversation's facts; no transport or page wiring. */
export function TripConditions(props: TripConditionsProps) {
  const copy = tripConditionsCopy(props.dict.locale);
  const titleId = useId();
  const submit = (event: SubmitEvent<HTMLFormElement>) => { event.preventDefault(); if (!props.busy) props.onContinue(cleanTravelConditions(props.value)); };
  return <section aria-labelledby={titleId} className="w-full text-fg"><h2 id={titleId} className="mb-6 text-xl font-bold leading-8 tracking-[-0.025em]">{copy.title}</h2>
    <form onSubmit={submit} aria-labelledby={titleId} className="grid gap-5"><MainConditions {...props} copy={copy} /><DepartureTime {...props} copy={copy} />
      <div className="pt-1 pb-2"><ContinueSuggestion {...props} copy={copy} /></div>
    </form>
  </section>;
}
