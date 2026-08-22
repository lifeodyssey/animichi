import type { ChangeEvent, KeyboardEvent, ReactElement } from "react";
import { useState } from "react";
import { useDict } from "../../i18n/LocaleProvider";

interface HeroSearchProps {
  onSubmit: (query: string) => void;
}

interface SearchState {
  query: string;
  setQuery: (query: string) => void;
  submit: () => void;
}

function useSearch(onSubmit: (query: string) => void): SearchState {
  const [query, setQuery] = useState("");
  const submit = () => { onSubmit(query.trim()); };
  return { query, setQuery, submit };
}

function SearchGlyph() {
  return (
    <svg className="hero-search__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

function SearchBar({ search }: { search: SearchState }) {
  const landing = useDict().landing;
  const onChange = (event: ChangeEvent<HTMLInputElement>) => { search.setQuery(event.target.value); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") search.submit(); };
  return (<div className="hero-search__bar">
    <SearchGlyph />
    <input className="hero-search__input" type="text" value={search.query} placeholder={landing.search_placeholder} aria-label={landing.search_placeholder} onChange={onChange} onKeyDown={onKeyDown} />
    <button className="hero-search__cta" type="button" onClick={search.submit}>{landing.cta}</button>
  </div>);
}

function StarDotsIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="3" /><circle cx="12" cy="5.5" r="2.6" /><circle cx="12" cy="18.5" r="2.6" /><circle cx="5.5" cy="12" r="2.6" /><circle cx="18.5" cy="12" r="2.6" />
    </svg>
  );
}

function MusicNoteIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" fill="currentColor" stroke="none" /><circle cx="16" cy="16" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CloudIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 18a4 4 0 0 1 .4-8A5 5 0 0 1 17 10.2 3.5 3.5 0 0 1 16.5 18Z" />
    </svg>
  );
}

const CHIP_STYLES = [
  { tone: "green", Icon: StarDotsIcon },
  { tone: "yellow", Icon: MusicNoteIcon },
  { tone: "blue", Icon: CloudIcon },
] as const;

function chipStyleFor(index: number) {
  return CHIP_STYLES[index % CHIP_STYLES.length] ?? CHIP_STYLES[0];
}

interface ExampleChipProps {
  example: string;
  index: number;
  onPick: (example: string) => void;
}

/** One coloured example chip: its tone and icon come from its position. */
function ExampleChip({ example, index, onPick }: ExampleChipProps) {
  const { tone, Icon } = chipStyleFor(index);
  return (
    <button type="button" className={`hero-chip hero-chip--${tone}`} onClick={() => { onPick(example); }}><Icon />{example}</button>
  );
}

function ExampleChips({ onPick }: { onPick: (example: string) => void }) {
  const landing = useDict().landing;
  return (<div className="hero-search__chips">
    {landing.examples.map((example, index) => (
      <ExampleChip key={example} example={example} index={index} onPick={onPick} />
    ))}
  </div>);
}

/** Hero pill search: field + teal CTA + colored example chips that fill and submit. */
export function HeroSearch({ onSubmit }: HeroSearchProps) {
  const search = useSearch(onSubmit);
  const pick = (example: string) => { search.setQuery(example); onSubmit(example); };
  return (
    <div className="hero-search">
      <SearchBar search={search} />
      <ExampleChips onPick={pick} />
    </div>);
}
