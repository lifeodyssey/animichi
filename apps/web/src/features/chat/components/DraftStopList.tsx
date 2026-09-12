import { Button } from "animal-island-ui-tailwind/button";
import { Input } from "animal-island-ui-tailwind/input";
import { useRef, useState } from "react";
import type { ChatDict } from "../i18n";
import type { DraftStop } from "../lib/itinerary-draft";
import { itineraryDraftCopy } from "../itinerary-draft-copy";
import { DraftStopRow } from "./DraftStopRow";
import type { DraftPlaceControls } from "./DraftPlaceControls";

interface Props { readonly stops: readonly DraftStop[]; readonly dict: ChatDict; readonly controls?: DraftPlaceControls }
interface SearchProps { readonly dict: ChatDict; readonly query: string; readonly onChange: (query: string) => void; readonly count: number; readonly total: number }

function matchesQuery(stop: DraftStop, query: string) {
  const content = [stop.place.name, stop.place.city, ...stop.place.viewpoints.map((viewpoint) => viewpoint.name)].join(" ").normalize("NFKC").toLocaleLowerCase();
  return query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/u).every((term) => content.includes(term));
}

function StopSearch(props: SearchProps) {
  const ref = useRef<HTMLInputElement>(null), copy = itineraryDraftCopy(props.dict.locale);
  const clear = () => { props.onChange(""); ref.current?.focus({ preventScroll: true }); };
  const suffix = props.query ? <Button type="text" htmlType="button" aria-label={copy.clearSearch} onClick={clear} className="[width:44px]! [height:44px]! [padding:0]! [--animal-text-color:var(--color-muted-fg)]"><span aria-hidden="true" className="text-xl font-normal">×</span></Button> : undefined;
  return <div className="sticky top-0 z-10 grid gap-2 bg-paper pb-3 pt-1"><Input ref={ref} value={props.query} onChange={(event) => { props.onChange(event.target.value); }} aria-label={copy.search} placeholder={copy.search} suffix={suffix} prefix={<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>} className="w-full [min-height:48px]! [border-color:var(--color-border-soft)]! [padding-block:0]! [--animal-primary-color:var(--color-primary-strong)] [--animal-text-color:var(--color-fg)] [&_input]:[font-size:16px]" />
    <p role="status" aria-atomic="true" className={props.query ? "text-xs leading-5 text-muted-fg" : "sr-only"}>{copy.matches.replace("{count}", String(props.count)).replace("{total}", String(props.total))}</p>
  </div>;
}

/** Filtering changes only the visible rows; original ordinals and the complete selection remain intact. */
export function DraftStopList({ stops, dict, controls }: Props) {
  const [query, setQuery] = useState(""), [expanded, setExpanded] = useState<string>();
  const results = stops.map((stop, index) => ({ stop, index })).filter(({ stop }) => matchesQuery(stop, query));
  return <div>{stops.length >= 8 || query ? <StopSearch dict={dict} query={query} onChange={setQuery} count={results.length} total={stops.length} /> : null}
    <ol aria-label={itineraryDraftCopy(dict.locale).order}>{results.map(({ stop, index }) => <DraftStopRow key={stop.place.id} stop={stop} index={index} dict={dict} controls={controls} expanded={expanded === stop.place.id} onExpand={() => { setExpanded(expanded === stop.place.id ? undefined : stop.place.id); }} />)}</ol>
    {results.length === 0 ? <p className="py-8 text-center text-sm leading-6 text-muted-fg">{itineraryDraftCopy(dict.locale).noMatches}</p> : null}
  </div>;
}
