import { useState } from "react";
import { MAX_MAP_PINS, searchMapView, topSpots } from "../../../lib/chat/spotClusters";
import type { SearchSpot, SpotCluster } from "../../../lib/chat/spotClusters";
import { attachBasemap } from "../../bubble-map/bubbleMapController";
import { episodeTag } from "../search-copy";
import { useSpotSelection } from "../selection/useSpotSelection";
import type { ChatDict } from "../i18n";
import { EnvelopeFallback } from "./ErrorStates/EnvelopeFallback";
import { SceneThumb } from "./ErrorStates/SceneThumb";
import { ClusterBubbleMap, StaticSpotMap } from "./SearchMap";
import type { AttachBasemap } from "./SearchMap";

type SpotProps = Readonly<{ spot: SearchSpot; dict: ChatDict }>;
type GridProps = Readonly<{ spots: readonly SearchSpot[]; dict: ChatDict }>;
type ClusterProps = Readonly<{ cluster: SpotCluster; dict: ChatDict; attach: AttachBasemap }>;

/** E2 (issue #273 S1.7): the pick is controlled by the shared spot selection. */
function SpotPick({ spot, dict }: SpotProps) {
  const { selected, toggle } = useSpotSelection();
  return (
    <label className="chat-spot-card__pick">
      <input type="checkbox" className="chat-spot-card__check" checked={selected.has(spot.id)} onChange={() => { toggle(spot.id); }} aria-label={`${dict.search.select}: ${spot.name}`} />
      <span className="chat-spot-card__name">{spot.name}</span>
    </label>
  );
}

/** C3a card: screenshot cover (D9-degrading) + episode tag + checkbox. */
function SpotCard({ spot, dict }: SpotProps) {
  const ep = episodeTag(dict, spot.ep);
  return (
    <li className="chat-spot-card">
      <SceneThumb src={spot.screenshotUrl} alt={spot.name} ep={spot.ep} dict={dict} />
      {ep ? <span className="chat-spot-card__ep">{ep}</span> : null}
      <SpotPick spot={spot} dict={dict} />
    </li>
  );
}

export function SpotCardGrid({ spots, dict }: GridProps) {
  return (
    <ul className="chat-spot-grid">
      {topSpots(spots).map((spot) => (
        <SpotCard key={spot.id} spot={spot} dict={dict} />
      ))}
    </ul>
  );
}

function SingleClusterView({ cluster, dict, attach }: ClusterProps) {
  return (
    <div className="chat-search-result">
      <SpotCardGrid spots={cluster.spots} dict={dict} />
      <StaticSpotMap spots={cluster.spots} dict={dict} attach={attach} maxPins={MAX_MAP_PINS} />
    </div>
  );
}

/** No locatable spot: the D2 state (issue #272 S1.6), never a silently empty map. */
function EmptyMapState({ spots, dict }: GridProps) {
  return (
    <div className="chat-search-result">
      {spots.length > 0 ? <SpotCardGrid spots={spots} dict={dict} /> : null}
      <EnvelopeFallback state="D2" dict={dict} />
    </div>
  );
}

type SearchResultProps = Readonly<{ spots: readonly SearchSpot[]; dict: ChatDict; attach?: AttachBasemap }>;

/**
 * C3a/C3b search content shape (issue #261 S1.4): a single cluster renders the
 * top-6 spot cards + a static pinned map; a multi-cluster (or >50km) result
 * renders the bubble overview, and selecting a bubble drills into C3a.
 */
export function SearchResult({ spots, dict, attach = attachBasemap }: SearchResultProps) {
  const view = searchMapView(spots);
  const [drill, setDrill] = useState<SpotCluster | null>(null);
  if (view.kind === "empty") return <EmptyMapState spots={spots} dict={dict} />;
  if (view.kind === "single") return <SingleClusterView cluster={view.cluster} dict={dict} attach={attach} />;
  if (drill !== null) return <SingleClusterView cluster={drill} dict={dict} attach={attach} />;
  return <ClusterBubbleMap clusters={view.clusters} dict={dict} attach={attach} onSelect={setDrill} />;
}
