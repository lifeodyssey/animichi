import { useId } from "react";
import type { SearchSpot } from "../lib/spot-clusters";
import { topSpots } from "../lib/spot-clusters";
import { episodeTag } from "../search-copy";
import { useSpotSelection } from "../selection/use-spot-selection";
import type { ChatDict } from "../i18n";
import { SearchScenePhoto, useSpotScene } from "./SearchScenePhoto";
import { GalleryFooter, GalleryHeader } from "./SearchGalleryControls";
import { ScenePick } from "./ScenePick";

type SpotProps = Readonly<{ spot: SearchSpot; dict: ChatDict }>;
type GridProps = Readonly<{ spots: readonly SearchSpot[]; dict: ChatDict }>;
type Scene = ReturnType<typeof useSpotScene>;

function SpotMetadata({ spot, dict }: SpotProps) {
  const copy = [spot.city, episodeTag(dict, spot.ep)].filter(Boolean).join(" · ");
  if (!copy) return null;
  return <span className="text-sm leading-relaxed text-muted-fg">{copy}</span>;
}

function SpotDetails({ spot, dict }: SpotProps) {
  return <div className="flex items-end gap-2 px-2 py-3"><div className="grid min-w-0 flex-1 gap-1"><span className="chat-spot-card__name break-words text-base font-bold leading-snug text-fg">{spot.name}</span><SpotMetadata spot={spot} dict={dict} /></div><SpotPick spot={spot} dict={dict} /></div>;
}

function SpotPick({ spot, dict }: SpotProps) {
  const { selected, toggle } = useSpotSelection();
  return <ScenePick id={spot.id} label={dict.search.select + ": " + spot.name} selected={selected.has(spot.id)} onToggle={() => { toggle(spot.id); }} />;
}

function SceneImageAction({ spot, dict, scene }: SpotProps & Readonly<{ scene: Scene }>) {
  if (!scene.src) return null;
  return <button type="button" className="block w-full cursor-zoom-in rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ground-ink" aria-label={dict.search.previewScene + ": " + spot.name} aria-haspopup="dialog" onClick={scene.onOpen}><SearchScenePhoto src={scene.src} name={spot.name} onError={scene.onError} /></button>;
}

const CARD = "chat-spot-card relative min-w-0 rounded-2xl border-2 border-transparent p-1 data-[selected=true]:border-primary data-[selected=true]:bg-primary-soft not-has-[img]:col-span-full";

function SpotCard({ spot, dict }: SpotProps) {
  const { selected } = useSpotSelection();
  const scene = useSpotScene(spot, dict);
  return <li className={CARD} data-selected={selected.has(spot.id)} data-image={Boolean(scene.src)}>
    <SceneImageAction spot={spot} dict={dict} scene={scene} />
    <SpotDetails spot={spot} dict={dict} />
    {scene.preview}
  </li>;
}

export function SpotCardGrid({ spots, dict }: GridProps) {
  const galleryId = useId();
  const visible = topSpots(spots);
  if (visible.length === 0) return null;
  return <section className="@container grid gap-5" aria-labelledby={galleryId + "-title"}><GalleryHeader dict={dict} galleryId={galleryId} />
    <ul id={galleryId} className="chat-spot-grid grid grid-cols-1 items-start gap-3 p-0 @min-[28rem]:has-[>li:nth-child(n+2)_img]:grid-cols-2 [list-style:none]">{visible.map((spot) => <SpotCard key={spot.id} spot={spot} dict={dict} />)}</ul>
    <GalleryFooter dict={dict} spots={spots} />
  </section>;
}
