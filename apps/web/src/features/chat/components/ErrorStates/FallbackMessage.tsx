type Kind = "search" | "place" | "clock" | "reply";
type Props = Readonly<{ kind: Kind; title: string; hint: string }>;
const PATHS: Readonly<Record<Kind, string>> = {
  search: "M16.5 16.5 21 21M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15M8 10.5h5",
  place: "M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12ZM12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2",
  reply: "M7 19 3 21V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7ZM8 8h8M8 12h5",
};

export function FallbackMessage({ kind, title, hint }: Props) {
  return <div className="flex min-w-0 items-start gap-3">
    <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-strong"><svg aria-hidden="true" focusable="false" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d={PATHS[kind]} /></svg></span>
    <div className="grid min-w-0 gap-1.5 [overflow-wrap:anywhere]"><h3 className="text-lg font-bold leading-7 text-fg">{title}</h3><p className="text-sm leading-6 text-muted-fg">{hint}</p></div>
  </div>;
}
