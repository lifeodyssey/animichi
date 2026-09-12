/** A caller-provided viewpoint groups frames; the card never infers proximity. */
export interface SceneFrame {
  readonly id: string;
  readonly url?: string;
  readonly caption?: string;
}

export interface SceneViewpoint {
  readonly id: string;
  /** Only display a viewpoint label if the caller actually has one. */
  readonly name?: string;
  readonly frames: readonly SceneFrame[];
}

export function sceneGroupLabel(placeName: string, viewpoint: SceneViewpoint): string {
  const label = viewpoint.name?.trim() ?? placeName;
  return label.length === 0 ? placeName : label;
}

export function sceneGroupTitle(placeName: string, viewpoint: SceneViewpoint): string {
  const label = sceneGroupLabel(placeName, viewpoint);
  return label === placeName ? placeName : `${placeName} · ${label}`;
}
