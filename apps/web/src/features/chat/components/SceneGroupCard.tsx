import { useState } from "react";
import type { ChatDict } from "../i18n";
import type { SceneViewpoint } from "../lib/scene-group";
import { sceneGroupLabel, sceneGroupTitle } from "../lib/scene-group";
import { sceneFrameCount, sceneGroupCopy } from "../scene-group-copy";
import { SceneIcon } from "./SceneIcon";
import { ScenePick } from "./ScenePick";
import { SceneGroupPreview } from "./SceneGroupPreview";

export interface SceneGroupCardProps {
  readonly placeName: string;
  readonly viewpoint: SceneViewpoint;
  readonly dict: ChatDict;
  readonly selected: boolean;
  readonly onToggle: () => void;
}

const CARD = "relative min-w-0 overflow-hidden rounded-2xl border-2 border-transparent bg-paper transition-colors data-[selected=true]:border-primary-strong data-[selected=true]:bg-primary-soft motion-reduce:transition-none";
type ImageProps = SceneGroupCardProps & Readonly<{ onPreview: () => void }>;

function FrameCount({ count, dict }: Readonly<{ count: number; dict: ChatDict }>) {
  if (count < 2) return null;
  return <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-ground-ink/80 px-2.5 py-1 text-xs font-bold text-paper">{sceneFrameCount(dict.locale, count)}</span>;
}

function SceneImage({ placeName, viewpoint, dict, onPreview }: ImageProps) {
  const source = viewpoint.frames.find((frame) => frame.url)?.url;
  const [failed, setFailed] = useState<string>();
  if (!source || source === failed) return <div className="flex aspect-video items-center justify-center gap-2 bg-card px-5 text-sm text-muted-fg"><span className="shrink-0"><SceneIcon name="photos" /></span>{source ? dict.search.sceneUnavailable : sceneGroupCopy(dict.locale).noImage}</div>;
  return <button type="button" className="relative block w-full cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ground-ink" aria-haspopup="dialog" aria-label={`${dict.search.previewScene}: ${sceneGroupTitle(placeName, viewpoint)}`} onClick={onPreview}>
    <img src={source} alt={sceneGroupTitle(placeName, viewpoint)} loading="lazy" decoding="async" onError={() => { setFailed(source); }} className="aspect-video h-auto! w-full! object-cover" />
    <FrameCount count={viewpoint.frames.filter((frame) => frame.url).length} dict={dict} />
  </button>;
}

function CardDetails({ placeName, viewpoint, dict, selected, onToggle }: SceneGroupCardProps) {
  return <div className="flex items-center gap-2 py-2 pl-3.5 pr-1.5"><span className="min-w-0 flex-1 text-base font-bold leading-relaxed text-fg">{sceneGroupLabel(placeName, viewpoint)}</span><ScenePick id={viewpoint.id} label={`${dict.search.select}: ${sceneGroupTitle(placeName, viewpoint)}`} selected={selected} onToggle={onToggle} /></div>;
}

/** One choice per viewpoint, regardless of its frame count. Previewing never selects. */
export function SceneGroupCard(props: SceneGroupCardProps) {
  const [preview, setPreview] = useState(false);
  return <article className={CARD} aria-label={sceneGroupTitle(props.placeName, props.viewpoint)} data-selected={props.selected}>
    <SceneImage {...props} onPreview={() => { setPreview(true); }} /><CardDetails {...props} />
    {preview ? <SceneGroupPreview key={props.viewpoint.id} {...props} onClose={() => { setPreview(false); }} /> : null}
  </article>;
}
