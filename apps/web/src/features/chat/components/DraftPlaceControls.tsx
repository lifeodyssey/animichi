import { Button } from "animal-island-ui-tailwind/button";
import type { SelectedPlace } from "../lib/selected-places";
import type { SceneViewpoint } from "../lib/scene-group";

export interface DraftPlaceControls {
  readonly availablePlaces: readonly SelectedPlace[];
  readonly disabled: boolean;
  readonly onRemove: (place: SelectedPlace) => void;
  readonly onToggle: (place: SelectedPlace, viewpoint: SceneViewpoint) => void;
}

export function RemoveDraftPlace({ label, disabled, onClick }: Readonly<{ label: string; disabled: boolean; onClick: () => void }>) {
  return <Button type="text" htmlType="button" disabled={disabled} onClick={onClick} title={label} aria-label={label} className="shrink-0 [width:44px]! [min-height:44px]! [padding:0]! [--animal-text-color:var(--color-muted-fg)] [--animal-bg-color-secondary:var(--color-primary-soft)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none"><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m7 7 10 10M17 7 7 17" /></svg></Button>;
}
