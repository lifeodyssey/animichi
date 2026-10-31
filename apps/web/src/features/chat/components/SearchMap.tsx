import type { LatLng } from "@animichi/contract";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { LocatedSpot, SpotCluster } from "../lib/spot-clusters";
import { bubbleRadius, circlesMaxCount } from "../../bubble-map/bubble-geometry";
import type { BubblePlacement, PointPlacement } from "../../bubble-map/bubble-geometry";
import type { BasemapStatus, MountBasemapOptions } from "../../bubble-map/bubble-map-controller";
import { clusterName, spotCountBadge } from "../search-copy";
import type { ChatDict } from "../i18n";
import { MapFallback } from "./ErrorStates/MapFallback";
import { useAutoFocus } from "./use-auto-focus";

/** Injectable mount so tests (and D7 simulations) never touch WebGL. */
export type AttachBasemap = (options: MountBasemapOptions) => () => void;

export interface Basemap {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly status: BasemapStatus;
  readonly placements: readonly PointPlacement[];
}

type MapCallbacks = Pick<MountBasemapOptions, "onStatus" | "onProject">;

function attachTo(
  container: HTMLDivElement | null, points: readonly LatLng[],
  attach: AttachBasemap, callbacks: MapCallbacks,
): (() => void) | undefined {
  if (!container || points.length === 0) return undefined;
  callbacks.onStatus("loading");
  callbacks.onProject?.([]);
  return attach({ container, points, ...callbacks, interactive: false });
}

function coordKey(points: readonly LatLng[]): string {
  return points.map((point) => `${String(point.lat)},${String(point.lng)}`).join("|");
}

/** Callers build the point array inline, so it is a fresh reference on every
 * render — and this card lives in the streaming chat surface, which re-renders
 * per SSE chunk. Without this, each chunk would tear down and rebuild a MapLibre
 * map (dynamic import + WebGL context + tile refetch); browsers cap live WebGL
 * contexts around 16. Identity is keyed on the coordinates themselves. */
function useStablePoints(points: readonly LatLng[]): readonly LatLng[] {
  const key = coordKey(points);
  const held = useRef({ key, points });
  if (held.current.key !== key) held.current = { key, points };
  return held.current.points;
}

export function useBasemap(points: readonly LatLng[], attach: AttachBasemap): Basemap {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<BasemapStatus>("loading");
  const [placements, setPlacements] = useState<readonly PointPlacement[]>([]);
  const stable = useStablePoints(points);
  useEffect(() => attachTo(ref.current, stable, attach, { onStatus: setStatus, onProject: setPlacements }), [stable, attach]);
  return { ref, status, placements };
}

type FrameProps = Readonly<{
  basemap: Basemap;
  role: "img" | "group";
  label: string;
  children: ReactNode;
}>;

function MapViewport({ basemap, role, label, children }: FrameProps) {
  return (
    <div className="chat-search-map" role={role} aria-label={label} aria-busy={basemap.status === "loading"}>
      {/* The important utilities beat maplibre-gl.css's `.maplibregl-map { position:
          relative }`, which is injected after chat.css and would otherwise collapse
          this container to zero height (map mounts blank while tiles load fine). */}
      <div ref={basemap.ref} className="chat-search-map__gl absolute! inset-0!" aria-hidden />
      {children}
    </div>
  );
}

function MapAttribution() {
  const link = "rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-primary";
  return (
    <p className="m-0 text-right text-[10px] leading-4 text-fg-muted">
      <a className={link} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>
      {" · "}<a className={link} href="https://protomaps.com" target="_blank" rel="noopener noreferrer">Protomaps</a>
    </p>
  );
}

export function MapFrame(props: FrameProps) {
  return <div className="grid gap-1.5"><MapViewport {...props} /><MapAttribution /></div>;
}

export function percentStyle(placement: PointPlacement): CSSProperties {
  return { left: `${String(placement.leftPct)}%`, top: `${String(placement.topPct)}%` };
}

function PinOverlay({ spots, placements }: Readonly<{ spots: readonly LocatedSpot[]; placements: readonly PointPlacement[] }>) {
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
      <PinOverlay spots={shown} placements={basemap.placements} />
    </MapFrame>
  );
}

function bubbleStyle(placement: BubblePlacement): CSSProperties {
  const size = placement.radius * 2;
  return { width: size, height: size, ...percentStyle(placement) };
}

type BubbleProps = Readonly<{ placement: BubblePlacement; dict: ChatDict; onClick: () => void; refocus: boolean }>;

function ClusterBubble({ placement, dict, onClick, refocus }: BubbleProps) {
  const ref = useAutoFocus<HTMLButtonElement>(refocus);
  return (
    <button ref={ref} type="button" className="chat-map-bubble" style={bubbleStyle(placement)} onClick={onClick}>
      <span className="chat-map-bubble__name">{placement.region}</span>
      <span className="chat-map-bubble__count">{spotCountBadge(placement.count, dict)}</span>
    </button>
  );
}

type BubbleMapProps = Readonly<{
  clusters: readonly SpotCluster[];
  dict: ChatDict;
  attach: AttachBasemap;
  onSelect: (cluster: SpotCluster, index: number) => void;
  /** Index of the bubble a drill was just backed out of; it reclaims focus. */
  refocusIndex: number | null;
}>;

type OverlayProps = Omit<BubbleMapProps, "attach"> & Readonly<{ placements: readonly PointPlacement[] }>;

function toCircle(cluster: SpotCluster, index: number, dict: ChatDict) {
  return {
    region: clusterName(cluster, index, dict),
    count: cluster.spots.length,
    lat: cluster.center.lat,
    lng: cluster.center.lng,
  };
}

function selectAt(clusters: readonly SpotCluster[], index: number, onSelect: BubbleMapProps["onSelect"]): void {
  const cluster = clusters[index];
  if (cluster) onSelect(cluster, index);
}

function BubbleOverlay({ clusters, dict, onSelect, refocusIndex, placements }: OverlayProps) {
  const circles = clusters.map((cluster, index) => toCircle(cluster, index, dict));
  const maxCount = circlesMaxCount(circles);
  const bubbles = circles.flatMap((circle, index) => placements[index] ? (
    // Keyed by position, not by region name: two clusters >50km apart can share
    // a city name (府中市 exists in both Tokyo and Hiroshima), and a duplicate
    // key silently drops one bubble.
    <ClusterBubble key={index} placement={{ ...circle, ...placements[index], radius: bubbleRadius(circle.count, maxCount) }} dict={dict} refocus={index === refocusIndex} onClick={() => { selectAt(clusters, index, onSelect); }} />
  ) : []);
  return <div className="chat-search-map__overlay chat-search-map__overlay--bubbles">{bubbles}</div>;
}

type BubbleFallbackProps = Readonly<{ dict: ChatDict; center?: LatLng; refocus: boolean }>;

/** D7 overview: no bubble survives to take focus, so the placeholder takes it. */
function BubbleMapFallback({ dict, center, refocus }: BubbleFallbackProps) {
  const ref = useAutoFocus<HTMLDivElement>(refocus);
  return (
    <div ref={ref} tabIndex={-1} className="chat-search-map__fallback">
      <MapFallback dict={dict} lat={center?.lat} lng={center?.lng} />
    </div>
  );
}

/** C3b overview: bubbles only (area ∝ count) — this zoom never draws pins. */
export function ClusterBubbleMap({ clusters, dict, attach, onSelect, refocusIndex }: BubbleMapProps) {
  const basemap = useBasemap(clusters.map((cluster) => cluster.center), attach);
  if (basemap.status === "fallback") return <BubbleMapFallback dict={dict} center={clusters[0]?.center} refocus={refocusIndex !== null} />;
  return (
    <MapFrame basemap={basemap} role="group" label={dict.search.mapLabel}>
      <BubbleOverlay clusters={clusters} dict={dict} onSelect={onSelect} refocusIndex={refocusIndex} placements={basemap.placements} />
    </MapFrame>
  );
}
