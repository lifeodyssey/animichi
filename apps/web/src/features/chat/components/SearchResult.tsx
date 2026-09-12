import { useCallback, useState } from "react";
import { MAX_MAP_PINS, searchMapView } from "../lib/spot-clusters";
import type { SearchSpot, SpotCluster } from "../lib/spot-clusters";
import { attachBasemap } from "../../bubble-map/bubble-map-controller";
import { clusterName, spotCountBadge } from "../search-copy";
import type { ChatDict } from "../i18n";
import { NoSpotsContent } from "./ErrorStates/EnvelopeFallback";
import { SpotCardGrid } from "./SearchSpotCard";
import { animalButtonClass } from "./AnimalButton";
import { ClusterBubbleMap, StaticSpotMap } from "./SearchMap";
import type { AttachBasemap } from "./SearchMap";
import { useAutoFocus } from "./use-auto-focus";

type GridProps = Readonly<{ spots: readonly SearchSpot[]; dict: ChatDict }>;
type ClusterProps = Readonly<{ cluster: SpotCluster; dict: ChatDict; attach: AttachBasemap }>;

function AreaSummary({ cluster, dict }: Omit<ClusterProps, "attach">) {
  return <div className="flex items-baseline justify-between gap-3"><p className="text-base font-bold text-fg">{clusterName(cluster, 0, dict)}</p><span className="text-xs text-muted-fg">{spotCountBadge(cluster.spots.length, dict)}</span></div>;
}

function SingleClusterView({ cluster, dict, attach }: ClusterProps) {
  return (
    <div className="chat-search-result @container grid gap-4">
      <AreaSummary cluster={cluster} dict={dict} />
      <SpotCardGrid spots={cluster.spots} dict={dict} />
      <StaticSpotMap spots={cluster.spots} dict={dict} attach={attach} maxPins={MAX_MAP_PINS} />
    </div>
  );
}

type DrillProps = ClusterProps & Readonly<{ onBack: () => void }>;

/** C3b→C3a keeps a way back to the 圏 overview, so the drill is not a dead end
 * (issue #437 item 2); the funnel in the S1.4 spec reads in both directions.
 * The chip also takes focus, since the view it replaced held it. */
function DrilledClusterView({ cluster, dict, attach, onBack }: DrillProps) {
  const ref = useAutoFocus<HTMLButtonElement>(true);
  return (
    <div className="chat-drill grid gap-3">
      <button ref={ref} type="button" className={animalButtonClass({ appearance: "text", className: "chat-drill__back justify-self-start [min-height:44px]!" })} onClick={onBack}><span>{dict.search.backToOverview}</span></button>
      <SingleClusterView cluster={cluster} dict={dict} attach={attach} />
    </div>
  );
}

type Drill = Readonly<{ cluster: SpotCluster; index: number }>;

interface DrillNav {
  readonly drill: Drill | null;
  /** Set only while returning, so a fresh drill never steals focus back. */
  readonly refocusIndex: number | null;
  readonly select: (cluster: SpotCluster, index: number) => void;
  readonly back: () => void;
}

/** Primitive drill-reset key: the caller rebuilds the spots array per SSE chunk,
 * so identity would reset the drill on every chunk — key on the spot ids. */
function spotsKey(spots: readonly SearchSpot[]): string {
  return spots.map((spot) => spot.id).join("|");
}

function useDrillNav(spots: readonly SearchSpot[]): DrillNav {
  const [drill, setDrill] = useState<Drill | null>(null);
  const [refocusIndex, setRefocus] = useState<number | null>(null);
  const select = useCallback((cluster: SpotCluster, index: number) => { setRefocus(null); setDrill({ cluster, index }); }, []);
  const back = useCallback(() => { setRefocus(drill?.index ?? null); setDrill(null); }, [drill]);
  const key = spotsKey(spots);
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) { setPrevKey(key); setDrill(null); setRefocus(null); }
  return { drill, refocusIndex, select, back };
}

/** No locatable spot: the D2 state (issue #272 S1.6), never a silently empty map. */
function EmptyMapState({ spots, dict }: GridProps) {
  return (
    <div className="chat-search-result @container grid gap-4">
      {spots.length > 0 ? <SpotCardGrid spots={spots} dict={dict} /> : null}
      <div className="grid gap-3" data-fallback="D2"><NoSpotsContent dict={dict} hasUnlocatedSpots={spots.length > 0} /></div>
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
  const nav = useDrillNav(spots);
  if (view.kind === "empty") return <EmptyMapState spots={spots} dict={dict} />;
  if (view.kind === "single") return <SingleClusterView cluster={view.cluster} dict={dict} attach={attach} />;
  if (nav.drill !== null) return <DrilledClusterView cluster={nav.drill.cluster} dict={dict} attach={attach} onBack={nav.back} />;
  return <ClusterBubbleMap clusters={view.clusters} dict={dict} attach={attach} onSelect={nav.select} refocusIndex={nav.refocusIndex} />;
}
