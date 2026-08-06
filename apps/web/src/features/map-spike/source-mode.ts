// `pmtiles` reads the range-served .pmtiles archive directly; `worker` hits the
// edge Worker's ZXY endpoint. The demo route lets a `?source=` query flip between them.
export type SourceMode = "pmtiles" | "worker";

const isSourceMode = (value: string | null): value is SourceMode => {
  return value === "pmtiles" || value === "worker";
};

export const parseSourceMode = (search: string): SourceMode => {
  const mode = new URLSearchParams(search).get("source");
  return isSourceMode(mode) ? mode : "pmtiles";
};
