import { Button } from "animal-island-ui-tailwind/button";
import type { ChatDict } from "../i18n";
import type { SelectedPlace } from "../lib/selected-places";
import type { SceneViewpoint } from "../lib/scene-group";
import { draftAdjustmentCopy } from "../draft-adjustment-copy";
import { SceneGroupCard } from "./SceneGroupCard";

interface Props {
  readonly dict: ChatDict;
  readonly available: readonly SelectedPlace[];
  readonly selected: readonly SelectedPlace[];
  readonly onToggle: (place: SelectedPlace, viewpoint: SceneViewpoint) => void;
  readonly onDone: () => void;
}

/** Uses caller-provided candidates; the full catalog/map browser is composed later. */
export function DraftPlacePicker({ dict, available, selected, onToggle, onDone }: Props) {
  const copy = draftAdjustmentCopy(dict.locale);
  return <section aria-label={copy.picker} className="@container/picker grid gap-3 rounded-2xl bg-primary-soft/40 p-3"><header className="flex items-center justify-between gap-2"><h3 className="text-base font-bold">{copy.picker}</h3><Button type="text" htmlType="button" onClick={onDone} className="[min-height:44px]! [padding:0_10px]! [font-size:13px]! [--animal-text-color:var(--color-primary-strong)] focus-visible:outline-primary-strong">{copy.done}</Button></header>
    <div className="grid max-h-[min(460px,65dvh)] [grid-template-columns:minmax(0,1fr)] gap-3 overflow-y-auto overscroll-contain p-1 @min-[20rem]/picker:[grid-template-columns:repeat(2,minmax(0,1fr))]">{available.flatMap((place) => place.viewpoints.map((viewpoint) => <SceneGroupCard key={`${place.id}:${viewpoint.id}`} placeName={place.name} viewpoint={viewpoint} dict={dict} selected={selected.some((item) => item.id === place.id && item.viewpoints.some((member) => member.id === viewpoint.id))} onToggle={() => { onToggle(place, viewpoint); }} />))}</div>
  </section>;
}
