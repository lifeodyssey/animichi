import type { LatLng } from "@seichijunrei/contract";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { LocatedSpot, SpotCluster } from "../../../lib/chat/spotClusters";
import { bubblePlacements, pointPlacements } from "../../bubble-map/bubbleGeometry";
import type { BubblePlacement, PointPlacement } from "../../bubble-map/bubbleGeometry";
import type { BasemapStatus, MountBasemapOptions } from "../../bubble-map/bubbleMapController";
import { clusterName, spotCountBadge } from "../search-copy";
import type { ChatDict } from "../i18n";
import { MapFallback } from "./ErrorStates/MapFallback";

/** Injectable mount so tests (and D7 simulations) never touch WebGL. */
export type AttachBasemap = (options: MountBasemapOptions) => () => void;

interface Basemap {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly status: BasemapStatus;
}

type StatusSetter = (status: BasemapStatus) => void;

function attachTo(
  container: HTMLDivElement | null,
  points: readonly LatLng[],
  onStatus: StatusSetter,
  attach: AttachBasemap,
): (() => void) | undefined {
  if (!container || points.length === 0) return undefined;
  return attach({ container, points, onStatus, interactive: false });
}

function useBasemap(points: readonly LatLng[], attach: AttachBasemap): Basemap {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<BasemapStatus>("loading");
  useEffect(() => attachTo(ref.current, points, setStatus, attach), [points, attach]);
  return { ref, status };
}

type FrameProps = Readonly<{
  basemap: Basemap;
  role: "img" | "group";
  label: string;
  children: ReactNode;
}>;

function MapFrame({ basemap, role, label, children }: FrameProps) {
  return (
    <div className="chat-search-map" role={role} aria-label={label}>
      <div ref={basemap.ref} className="chat-search-map__gl" aria-hidden />
      {children}
    </div>
  );
}

function percentStyle(placement: PointPlacement): CSSProperties {
  return { left: `${String(placement.leftPct)}%`, top: `${String(placement.topPct)}%` };
}

function PinOverlay({ spots }: Readonly<{ spots: readonly LocatedSpot[] }>) {
  const placements = pointPlacements(spots.map((spot) => spot.coord));
  const pins = placements.map((placement, index) => (
    <span key={spots[index]?.id ?? String(index)} className="chat-map-pin" style={percentStyle(placement)} />
  ));
  return <div className="chat-search-map__overlay">{pins}</div>;
}

type SpotMapProps = Readonly<{ spots: readonly LocatedSpot[]; dict: ChatDict; attach: AttachBasemap; maxPins: number }>;

function SpotMapFallback({ spots, dict }: Readonly<{ spots: readonly LocatedSpot[]; dict: ChatDict }>) {
  const first = spots[0];
  return <MapFallback dict={dict} lat={first?.coord.lat} lng={first?.coord.lng} />;
}

/** C3a static map: framed basemap + ≤50 DOM pins; tile failure degrades to D7. */
export function StaticSpotMap({ spots, dict, attach, maxPins }: SpotMapProps) {
  const shown = spots.slice(0, maxPins);
  const basemap = useBasemap(shown.map((spot) => spot.coord), attach);
  if (basemap.status === "fallback") return <SpotMapFallback spots={spots} dict={dict} />;
  return (
    <MapFrame basemap={basemap} role="img" label={dict.search.mapLabel}>
      <PinOverlay spots={shown} />
    </MapFrame>
  );
}

function bubbleStyle(placement: BubblePlacement): CSSProperties {
  const size = placement.radius * 2;
  return { width: size, height: size, ...percentStyle(placement) };
}

type BubbleProps = Readonly<{ placement: BubblePlacement; dict: ChatDict; onClick: () => void }>;

function ClusterBubble({ placement, dict, onClick }: BubbleProps) {
  return (
    <button type="button" className="chat-map-bubble" style={bubbleStyle(placement)} onClick={onClick}>
      <span className="chat-map-bubble__name">{placement.region}</span>
      <span className="chat-map-bubble__count">{spotCountBadge(placement.count, dict)}</span>
    </button>
  );
}

type BubbleMapProps = Readonly<{
  clusters: readonly SpotCluster[];
  dict: ChatDict;
  attach: AttachBasemap;
  onSelect: (cluster: SpotCluster) => void;
}>;

type OverlayProps = Omit<BubbleMapProps, "attach">;

function toCircle(cluster: SpotCluster, index: number, dict: ChatDict) {
  return {
    region: clusterName(cluster, index, dict),
    count: cluster.spots.length,
    lat: cluster.center.lat,
    lng: cluster.center.lng,
  };
}

function selectAt(clusters: readonly SpotCluster[], index: number, onSelect: (cluster: SpotCluster) => void): void {
  const cluster = clusters[index];
  if (cluster) onSelect(cluster);
}

function BubbleOverlay({ clusters, dict, onSelect }: OverlayProps) {
  const circles = clusters.map((cluster, index) => toCircle(cluster, index, dict));
  const bubbles = bubblePlacements(circles).map((placement, index) => (
    <ClusterBubble key={placement.region} placement={placement} dict={dict} onClick={() => { selectAt(clusters, index, onSelect); }} />
  ));
  return <div className="chat-search-map__overlay chat-search-map__overlay--bubbles">{bubbles}</div>;
}

/** C3b overview: bubbles only (area ∝ count) — this zoom never draws pins. */
export function ClusterBubbleMap({ clusters, dict, attach, onSelect }: BubbleMapProps) {
  const basemap = useBasemap(clusters.map((cluster) => cluster.center), attach);
  const first = clusters[0];
  if (basemap.status === "fallback") return <MapFallback dict={dict} lat={first?.center.lat} lng={first?.center.lng} />;
  return (
    <MapFrame basemap={basemap} role="group" label={dict.search.mapLabel}>
      <BubbleOverlay clusters={clusters} dict={dict} onSelect={onSelect} />
    </MapFrame>
  );
}
