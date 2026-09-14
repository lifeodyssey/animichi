import { Button } from "animal-island-ui-tailwind/button";
import type { ChatDict } from "../i18n";
import { selectedPlaceCount, selectionSummaryCopy } from "../selection-summary-copy";
import { SceneIcon } from "./SceneIcon";

export interface SelectionSummaryProps {
  /** Distinct stopping places, already deduplicated by the selection owner. */
  readonly placeCount: number;
  readonly dict: ChatDict;
  readonly busy?: boolean;
  readonly onReview: () => void;
  readonly onContinue: () => void;
}

const REVIEW = "[height:auto]! [min-height:56px]! [padding:0px]! @min-[22rem]/selection:[padding:0_4px]! [border-radius:10px]! justify-self-start text-left [--animal-text-color:var(--color-fg)] [--animal-bg-color-secondary:var(--color-primary-soft)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";
const CONTINUE = "[min-height:44px]! [padding:0_12px]! @min-[22rem]/selection:[padding:0_16px]! [font-size:14px]! [--animal-bg-color:var(--color-gold)] [--animal-text-color:var(--color-gold-ink)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";

function ReviewSelection({ placeCount, dict, onReview }: SelectionSummaryProps) {
  const copy = selectionSummaryCopy(dict.locale);
  return <Button type="text" htmlType="button" className={REVIEW} disabled={placeCount === 0} onClick={onReview} aria-label={copy.review}>
    <span className="grid justify-items-start gap-1">
      <span role="status" aria-atomic="true" className="[font-size:14px] font-bold leading-6 tabular-nums @min-[22rem]/selection:[font-size:16px]">{selectedPlaceCount(dict.locale, placeCount)}</span>
      <span className="flex items-center gap-1 text-sm font-medium leading-5 text-muted-fg">{copy.review}<span className="[&_svg]:size-3.5"><SceneIcon name="next" /></span></span>
    </span>
  </Button>;
}

function ContinuePlanning({ placeCount, busy, dict, onContinue }: SelectionSummaryProps) {
  const copy = selectionSummaryCopy(dict.locale);
  return <Button type="primary" htmlType="button" className={CONTINUE} disabled={placeCount === 0 || busy} aria-busy={busy} onClick={onContinue}>
    <span className="grid items-center [grid-template-areas:'action']">
      <span className="[grid-area:action] [visibility:hidden] data-[visible=true]:[visibility:visible]" aria-hidden={busy} data-visible={!busy}>{copy.continue}</span>
      <span className="[grid-area:action] [visibility:hidden] data-[visible=true]:[visibility:visible]" aria-hidden={!busy} data-visible={Boolean(busy)}>{copy.busy}</span>
    </span>
  </Button>;
}

/** Isolated browse-footer UI; callbacks belong to the future browser composition. */
export function SelectionSummary(props: SelectionSummaryProps) {
  return <div className="@container/selection w-full"><div role="group" aria-label={selectionSummaryCopy(props.dict.locale).label} className="grid min-h-[88px] w-full [grid-template-columns:minmax(0,1fr)] items-center gap-2 rounded-2xl border border-border-soft bg-paper px-3 py-3 text-fg @min-[18rem]/selection:[grid-template-columns:minmax(0,1fr)_auto]">
    <ReviewSelection {...props} />
    <ContinuePlanning {...props} />
  </div></div>;
}
