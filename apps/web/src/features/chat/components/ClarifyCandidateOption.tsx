import { useState } from "react";
import { AnimalButton } from "./AnimalButton";
import type { candidatesOf } from "./Cards";
import type { Locale } from "../../../i18n/locales";
import { localizedWorkTitle } from "../lib/work-title";

type Candidate = ReturnType<typeof candidatesOf>[number];
export type ClarifyOptionState = "available" | "selected" | "unselected" | "dismissed";
type Props = Readonly<{ candidate: Candidate; locale: Locale; label: string; state: ClarifyOptionState; showCover: boolean; disabled?: boolean; onChoose: (candidate: Candidate) => void }>;

function CoverPlaceholder() {
  return <svg aria-hidden="true" className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 6a3 3 0 0 1 3-3h11v18H8a3 3 0 0 1-3-3Zm0 12a3 3 0 0 1 3-3h11M9 7h6M9 10h4" /></svg>;
}

/** Reserve the same artwork column throughout a list, even when an image fails. */
function CandidateCover({ src, visible }: Readonly<{ src?: string | null; visible: boolean }>) {
  const [failed, setFailed] = useState(false);
  if (!visible) return null;
  return (
    <span className="chat-clarify__cover flex h-20 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-fg">
      {src && !failed ? <img src={src} alt="" width={56} height={80} loading="lazy" className="h-full w-full object-cover" onError={() => { setFailed(true); }} /> : <CoverPlaceholder />}
    </span>
  );
}

function CandidateTitles({ candidate, locale }: Pick<Props, "candidate" | "locale">) {
  const { primary, secondary } = localizedWorkTitle(candidate, locale);
  return (
    <span className="grid min-w-0 flex-1 gap-1 [overflow-wrap:anywhere]">
      <span className="text-base font-bold leading-snug text-fg [word-break:keep-all] group-data-[state=selected]/clarify:text-explore-fg">{primary}</span>
      {secondary && <span className="text-sm font-medium leading-normal text-muted-fg [text-wrap:pretty] group-data-[state=selected]/clarify:text-explore-fg">{secondary}</span>}
    </span>
  );
}

function CandidateIndicator({ selected }: Readonly<{ selected: boolean }>) {
  const color = selected ? "bg-primary text-primary-ink" : "text-muted-fg group-data-[state=unselected]/clarify:invisible group-data-[state=dismissed]/clarify:invisible";
  return (
    <span aria-hidden="true" className={`flex size-6 shrink-0 items-center justify-center rounded-full ${color}`}>
      <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={selected ? "m3 8 3 3 7-7" : "m6 4 4 4-4 4"} /></svg>
    </span>
  );
}

const OPTION = [
  "chat-clarify__option group/clarify [border-radius:16px] [border-width:1px]! [padding:12px]! [min-height:64px]! [text-align:left]! [&>span]:w-full",
  "enabled:hover:[background:var(--color-primary-soft)] enabled:hover:[border-color:var(--color-primary)]",
  "data-[state=selected]:opacity-100 data-[state=selected]:[background:var(--color-primary-soft)] data-[state=selected]:[border-color:var(--color-primary)]",
  "data-[state=unselected]:opacity-75 data-[state=dismissed]:opacity-75",
].join(" ");

export function ClarifyCandidateOption({ candidate, locale, label, state, showCover, disabled, onChoose }: Props) {
  return (
    <li><AnimalButton appearance="default" block className={OPTION} data-state={state} aria-label={label} aria-pressed={state === "selected"} disabled={disabled === true || state !== "available"} onClick={() => { onChoose(candidate); }}>
      <span className="flex w-full items-center [gap:12px] sm:[gap:16px]">
        <CandidateCover key={candidate.cover_url ?? "none"} src={candidate.cover_url} visible={showCover} />
        <CandidateTitles candidate={candidate} locale={locale} /><CandidateIndicator selected={state === "selected"} />
      </span>
    </AnimalButton></li>
  );
}
