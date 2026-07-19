import type { ChangeEvent, KeyboardEvent } from "react";
import { useState } from "react";
import { useDict } from "../../i18n/context";

const CHIP_TONES = ["mint", "gold", "plain"] as const;

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
    <svg className="hero-search__glyph" viewBox="0 0 24 24" width={19} height={19} fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.8-3.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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

function toneFor(index: number): string {
  return CHIP_TONES[index % CHIP_TONES.length] ?? "plain";
}

function ChipList({ onPick }: { onPick: (example: string) => void }) {
  const landing = useDict().landing;
  return (<div className="hero-search__chips">
    {landing.examples.map((example, index) => (
      <button key={example} type="button" className={`hero-chip hero-chip--${toneFor(index)}`} onClick={() => { onPick(example); }}>{example}</button>
    ))}
  </div>);
}

function ExampleChips({ onPick }: { onPick: (example: string) => void }) {
  const landing = useDict().landing;
  return (<div className="hero-search__examples">
    <p className="hero-search__examples-label">{landing.try_example}</p>
    <ChipList onPick={onPick} />
  </div>);
}

/** Hero pill search: field + pumpkin CTA + "try an example" chips that fill and submit. */
export function HeroSearch({ onSubmit }: HeroSearchProps) {
  const search = useSearch(onSubmit);
  const pick = (example: string) => { search.setQuery(example); onSubmit(example); };
  return (
    <div className="hero-search">
      <SearchBar search={search} />
      <ExampleChips onPick={pick} />
    </div>);
}
