import { useState } from "react";
import { ANITABI_MOBILE_PLAN, ANITABI_THUMBNAIL_PLAN, withAnitabiImagePlan } from "@animichi/contract/anitabi-display";
import { ShotCredit } from "../../../lib/landmark-shot";
import type { SearchSpot } from "../lib/spot-clusters";
import type { ChatDict } from "../i18n";
import { episodeTag } from "../search-copy";
import { ScenePreview } from "./ScenePreview";

/** A new URL retries the photo without remounting the place or its selection. */
export function useSpotScene(spot: SearchSpot, dict: ChatDict) {
  const [failedSource, setFailedSource] = useState<string>();
  const [open, setOpen] = useState(false);
  const src = spot.screenshotUrl === failedSource ? undefined : spot.screenshotUrl;
  const preview = open && src ? spotPreview(spot, dict, src, () => { setOpen(false); }) : null;
  return { src, preview, onOpen: () => { setOpen(true); }, onError: () => { setFailedSource(spot.screenshotUrl); } };
}

function spotPreview(spot: SearchSpot, dict: ChatDict, src: string, onClose: () => void) {
  const caption = [spot.city, episodeTag(dict, spot.ep)].filter(Boolean).join(" · ");
  return <ScenePreview key={src} src={withAnitabiImagePlan(src, ANITABI_MOBILE_PLAN)} name={spot.name} caption={caption} closeLabel={dict.search.closePreview} failureMessage={dict.search.sceneUnavailable} onClose={onClose} footer={spotCredit(spot)} />;
}

function spotCredit(spot: SearchSpot) {
  return <ShotCredit credit={{ origin: spot.origin, originUrl: spot.originUrl }} />;
}

type PhotoProps = Readonly<{ src?: string; name: string; onError: () => void }>;

export function SearchScenePhoto({ src, name, onError }: PhotoProps) {
  if (!src) return null;
  return <img className="chat-scene-thumb aspect-video h-auto! w-full! rounded-xl! object-cover" src={withAnitabiImagePlan(src, ANITABI_THUMBNAIL_PLAN)} alt={name} decoding="async" onError={onError} />;
}
