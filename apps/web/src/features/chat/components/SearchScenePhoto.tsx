import { useState } from "react";
import type { SearchSpot } from "../lib/spot-clusters";
import type { ChatDict } from "../i18n";
import { episodeTag } from "../search-copy";
import { ScenePreview } from "./ScenePreview";

/** A new URL retries the photo without remounting the place or its selection. */
export function useSpotScene(spot: SearchSpot, dict: ChatDict) {
  const [failedSource, setFailedSource] = useState<string>();
  const [open, setOpen] = useState(false);
  const src = spot.screenshotUrl === failedSource ? undefined : spot.screenshotUrl;
  const caption = [spot.city, episodeTag(dict, spot.ep)].filter(Boolean).join(" · ");
  const preview = open && src ? <ScenePreview key={src} src={src} name={spot.name} caption={caption} closeLabel={dict.search.closePreview} failureMessage={dict.search.sceneUnavailable} onClose={() => { setOpen(false); }} /> : null;
  return { src, preview, onOpen: () => { setOpen(true); }, onError: () => { setFailedSource(spot.screenshotUrl); } };
}

type PhotoProps = Readonly<{ src?: string; name: string; onError: () => void }>;

export function SearchScenePhoto({ src, name, onError }: PhotoProps) {
  if (!src) return null;
  return <img className="chat-scene-thumb aspect-video h-auto! w-full! rounded-xl! object-cover" src={src} alt={name} loading="lazy" decoding="async" onError={onError} />;
}
