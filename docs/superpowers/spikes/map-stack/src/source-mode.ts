export type SourceMode = "pmtiles" | "worker";

const isSourceMode = (value: string | null): value is SourceMode => {
  return value === "pmtiles" || value === "worker";
};

export const getSourceMode = (): SourceMode => {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("source");
  return isSourceMode(mode) ? mode : "pmtiles";
};

export const setSourceMode = (mode: SourceMode): void => {
  const params = new URLSearchParams(window.location.search);
  params.set("source", mode);
  window.location.search = params.toString();
};
