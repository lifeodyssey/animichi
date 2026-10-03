import { Button } from "animal-island-ui-tailwind/button";
import { useMemo, useState } from "react";
import type { ChatDict } from "../i18n";
import type { SelectedPlace } from "../lib/selected-places";
import { placeIdToggles, selectedPlacesFromSpots } from "../lib/selected-places";
import { searchMapView } from "../lib/spot-clusters";
import type { SearchMapView, SearchSpot, SpotCluster } from "../lib/spot-clusters";
import { SpotSelectionProvider, useSpotSelection, useSpotSelectionState } from "../selection/use-spot-selection";
import { SelectedPlacesList } from "./SelectedPlacesList";
import { SelectableSpotMap } from "./SelectableSpotMap";
import { ClusterBubbleMap, attachBasemap } from "./SearchMap";
import type { AttachBasemap } from "./SearchMap";
import { SearchResult } from "./SearchResult";
import { SpotCardGrid } from "./SearchSpotCard";
import { SelectionSummary } from "./SelectionSummary";
import { chatButtonClass } from "./chat-button-classes";

/** Which browsing surface the workspace shows; switching never touches the selection. */
export type BrowseView = "photos" | "map";

export interface SelectionJourneyProps {
  readonly spots: readonly SearchSpot[];
  readonly dict: ChatDict;
  readonly attach?: AttachBasemap;
  readonly onContinue?: (ids: readonly string[]) => void;
}

const BACK = "justify-self-start [min-height:44px]!";
const TOGGLE_GROUP = "grid [grid-template-columns:repeat(2,auto)] gap-1 rounded-xl bg-primary-soft/60 p-1";
const TOGGLE_OPTION = "rounded-lg px-3 [min-height:36px] text-sm font-bold";

function spotsKey(spots: readonly SearchSpot[]): string {
  return spots.map((spot) => spot.id).join("|");
}

/** Region under browse; a fresh spot set (a new turn) resets the drill. */
function useJourneyRegion(spots: readonly SearchSpot[]): readonly [SpotCluster | null, (region: SpotCluster | null) => void] {
  const [region, setRegion] = useState<SpotCluster | null>(null);
  const key = spotsKey(spots);
  const [prev, setPrev] = useState(key);
  if (prev !== key) { setPrev(key); setRegion(null); }
  return [region, setRegion];
}

type ToggleProps = Readonly<{ view: BrowseView; dict: ChatDict; onView: (view: BrowseView) => void }>;

function ViewToggle({ view, dict, onView }: ToggleProps) {
  const option = (key: BrowseView, label: string) => (
    <button key={key} type="button" aria-pressed={view === key} onClick={() => { onView(key); }} className={`${TOGGLE_OPTION} ${view === key ? "bg-paper text-fg shadow-sm" : "text-muted-fg"}`}>{label}</button>
  );
  return <div role="group" aria-label={dict.search.viewSwitch} className={TOGGLE_GROUP}>{option("photos", dict.search.photoView)}{option("map", dict.search.mapView)}</div>;
}

function BackToOverview({ dict, onBack }: Readonly<{ dict: ChatDict; onBack: () => void }>) {
  return <Button htmlType="button" type="text" className={chatButtonClass({ className: BACK })} onClick={onBack}><span>{dict.search.backToOverview}</span></Button>;
}

type RegionProps = Readonly<{ cluster: SpotCluster; dict: ChatDict; attach: AttachBasemap; multi: boolean; onBack: () => void }>;

/** Photo and map views read and write the one selection; the toggle swaps only the surface. */
function RegionWorkspace({ cluster, dict, attach, multi, onBack }: RegionProps) {
  const [view, setView] = useState<BrowseView>("photos");
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      {multi ? <BackToOverview dict={dict} onBack={onBack} /> : null}
      <ViewToggle view={view} dict={dict} onView={setView} />
    </div>
    {view === "photos" ? <SpotCardGrid spots={cluster.spots} dict={dict} /> : <SelectableSpotMap spots={cluster.spots} dict={dict} attach={attach} />}
  </>;
}

type BrowseProps = SelectionJourneyProps & Readonly<{
  region: SpotCluster | null;
  onRegion: (region: SpotCluster | null) => void;
  places: readonly SelectedPlace[];
  onReview: () => void;
}>;

function BrowseSummary({ dict, places, onReview, onContinue }: Pick<BrowseProps, "dict" | "places" | "onReview" | "onContinue">) {
  const { selected } = useSpotSelection();
  return <SelectionSummary placeCount={places.length} dict={dict} onReview={onReview} onContinue={() => onContinue?.([...selected])} />;
}

function BrowseContent({ spots, dict, attach = attachBasemap, onRegion, overview, active }: Omit<BrowseProps, "places" | "onReview" | "region"> & Readonly<{ overview: SearchMapView; active: SpotCluster | null }>) {
  if (active !== null) return <RegionWorkspace cluster={active} dict={dict} attach={attach} multi={overview.kind === "multi"} onBack={() => { onRegion(null); }} />;
  if (overview.kind === "multi") return <ClusterBubbleMap clusters={overview.clusters} dict={dict} attach={attach} onSelect={onRegion} refocusIndex={null} />;
  return <SearchResult spots={spots} dict={dict} attach={attach} />;
}

function JourneyBrowse(props: BrowseProps) {
  const overview = searchMapView(props.spots);
  const active = props.region ?? (overview.kind === "single" ? overview.cluster : null);
  return <section className="grid gap-4">
    <BrowseContent {...props} overview={overview} active={active} />
    {props.spots.length > 0 ? <BrowseSummary dict={props.dict} places={props.places} onReview={props.onReview} onContinue={props.onContinue} /> : null}
  </section>;
}

function JourneyBody({ spots, dict, attach, onContinue }: SelectionJourneyProps) {
  const { selected, toggle } = useSpotSelection();
  const places = useMemo(() => selectedPlacesFromSpots(spots, selected), [spots, selected]);
  const [reviewing, setReviewing] = useState(false);
  const [region, onRegion] = useJourneyRegion(spots);
  if (reviewing) return <SelectedPlacesList places={places} dict={dict} onBack={() => { setReviewing(false); }} onChange={(next) => { for (const id of placeIdToggles(places, next)) toggle(id); }} />;
  return <JourneyBrowse spots={spots} dict={dict} attach={attach} onContinue={onContinue} region={region} onRegion={onRegion} places={places} onReview={() => { setReviewing(true); }} />;
}

/** Fixture-only composed journey (issue #1641 slice 1): one selection scope keyed
 * by stable place id behind region discovery, photo cards, map markers, the
 * summary and the review list. Page integration stays a later step. */
export function SelectionJourney(props: SelectionJourneyProps) {
  const selection = useSpotSelectionState();
  return <SpotSelectionProvider selection={selection}><JourneyBody {...props} /></SpotSelectionProvider>;
}
