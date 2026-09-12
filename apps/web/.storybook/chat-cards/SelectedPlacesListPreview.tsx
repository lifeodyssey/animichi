import { useState } from "react";
import { SelectedPlacesList } from "../../src/features/chat/components/SelectedPlacesList";
import type { SelectedPlacesListProps } from "../../src/features/chat/components/SelectedPlacesList";
import type { SelectedPlace } from "../../src/features/chat/lib/selected-places";

export function SelectedPlacesListPreview(props: SelectedPlacesListProps) {
  const [places, setPlaces] = useState(props.places);
  const onChange = (next: readonly SelectedPlace[]) => { setPlaces(next); props.onChange(next); };
  return <div style={{ width: "min(440px, calc(100vw - 80px))", maxWidth: "100%" }}><SelectedPlacesList {...props} places={places} onChange={onChange} /></div>;
}
