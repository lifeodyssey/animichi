import type { StepStatus } from "../tool-steps";

type Kind = StepStatus | "details" | "chevron";
const PATHS: Readonly<Record<Kind, string>> = {
  running: "M20 12a8 8 0 1 1-8-8",
  done: "m5 12 4 4L19 6",
  error: "m7 7 10 10M17 7 7 17",
  retried: "M4 9a8 8 0 1 1 1 8M4 4v5h5",
  details: "M9 6h11M9 12h11M9 18h7M4 6h.01M4 12h.01M4 18h.01",
  chevron: "m6 9 6 6 6-6",
};

export function ProgressGlyph({ kind }: Readonly<{ kind: Kind }>) {
  const motion = kind === "running" ? "animate-spin motion-reduce:animate-none" : "";
  return <svg className={`size-4 shrink-0 ${motion}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[kind]} /></svg>;
}
