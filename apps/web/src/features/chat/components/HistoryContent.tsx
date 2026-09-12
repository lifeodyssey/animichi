import { Button } from "animal-island-ui-tailwind/button";
import type { ChatDict } from "../i18n";
import type { HistoryReplayBlock } from "../lib/history-replay";
import type { ItineraryDraftPlan } from "../lib/itinerary-draft";
import type { SelectedPlace } from "../lib/selected-places";
import { historyReplayCopy } from "../history-replay-copy";
import { itineraryDraftCopy } from "../itinerary-draft-copy";
import { ItineraryDraftDocument } from "./ItineraryDraft";
import { SelectedPlaceThumbnail } from "./SelectedPlaceThumbnail";

interface Props {
  readonly block: HistoryReplayBlock;
  readonly dict: ChatDict;
  readonly ready: boolean;
  readonly onContinueDraft?: (draftId: string) => void;
}

const CONTINUE = "[min-height:48px]! [height:auto]! [padding:10px_16px]! [font-size:14px]! [white-space:normal]! [--animal-bg-color:var(--color-gold)] [--animal-text-color:var(--color-gold-ink)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";

function PlacePictures({ place, dict }: Readonly<{ place: SelectedPlace; dict: ChatDict }>) {
  return <section className="grid min-w-0 gap-2.5"><div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><h3 className="text-sm font-bold leading-6">{place.name}</h3>{place.city ? <p className="text-xs leading-5 text-muted-fg">{place.city}</p> : null}</div>
    <div className="grid grid-cols-2 gap-3">{place.viewpoints.map((viewpoint) => <figure key={viewpoint.id} className="grid min-w-0 gap-1.5"><div className="[&>button]:aspect-video [&>button]:[height:auto] [&>button]:min-h-11 [&>span]:aspect-video [&>span]:[height:auto]"><SelectedPlaceThumbnail placeName={place.name} viewpoint={viewpoint} dict={dict} /></div>{viewpoint.name?.trim() ? <figcaption className="text-xs leading-5 text-muted-fg [overflow-wrap:anywhere]">{viewpoint.name}</figcaption> : null}</figure>)}</div>
    {place.viewpoints.length === 0 ? <p className="text-sm leading-6 text-muted-fg">{historyReplayCopy(dict.locale).noPictures}</p> : null}
  </section>;
}

function DraftFooter({ draft, dict, ready, onContinueDraft }: Omit<Props, "block"> & Readonly<{ draft: ItineraryDraftPlan }>) {
  const copy = historyReplayCopy(dict.locale);
  return <div className="grid justify-items-start gap-3"><p className="text-xs leading-5 text-muted-fg">{itineraryDraftCopy(dict.locale).note}</p>
    {onContinueDraft && draft.stops.length > 0 ? <Button type="primary" htmlType="button" className={CONTINUE} disabled={!ready} title={ready ? undefined : copy.continueHint} onClick={() => { onContinueDraft(draft.id); }}>{copy.continueDraft}</Button> : null}
  </div>;
}

/** Historical cards support reading and explicit continuation, never in-place selection edits. */
export function HistoryContent({ block, ...props }: Props) {
  const copy = historyReplayCopy(props.dict.locale);
  if (block.kind === "unavailable") return <p className="border-l-2 border-border-soft py-1 pl-3 text-sm leading-6 text-muted-fg">{block.content === "scenes" ? copy.scenesMissing : copy.draftMissing}</p>;
  if (block.kind === "scenes") return <div className="grid w-full min-w-0 gap-5">{block.places.map((place) => <PlacePictures key={place.id} place={place} dict={props.dict} />)}</div>;
  return <div className="w-full min-w-0 pt-1"><ItineraryDraftDocument key={block.draft.id} draft={block.draft} dict={props.dict} footer={<DraftFooter draft={block.draft} {...props} />} /></div>;
}
