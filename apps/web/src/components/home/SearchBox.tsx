import type { ChangeEvent, KeyboardEvent } from "react";
import { useState } from "react";
import { useDict } from "../../i18n/context";

interface SearchBoxProps {
  readonly onSubmit: (query: string) => void;
}

function useSearchBox(onSubmit: (query: string) => void) {
  const [query, setQuery] = useState("");
  const submit = () => { onSubmit(query.trim()); };
  const onChange = (event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") submit(); };
  return { query, submit, onChange, onKeyDown };
}

/** App Home search box: submits the query into `/chat` (spec S5.5, reuses S1.1 A2). */
export function SearchBox({ onSubmit }: SearchBoxProps) {
  const home = useDict().home;
  const box = useSearchBox(onSubmit);
  return (
    <div className="flex gap-2 rounded-2xl bg-[var(--color-card)] p-2 shadow-sm">
      <input type="search" className="flex-1 rounded-xl bg-transparent px-3 py-2 text-[var(--color-fg)] outline-none" value={box.query} placeholder={home.search_placeholder} aria-label={home.search_placeholder} onChange={box.onChange} onKeyDown={box.onKeyDown} />
      <button type="button" className="rounded-xl bg-[var(--color-primary)] px-4 py-2 font-bold text-[var(--color-primary-fg)]" onClick={box.submit}>{home.search_cta}</button>
    </div>
  );
}
