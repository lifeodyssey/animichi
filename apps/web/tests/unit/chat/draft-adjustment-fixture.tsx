import { useState } from "react";
import { DraftAdjustment } from "../../../src/features/chat/components/DraftAdjustment";
import type { DraftAdjustmentProps } from "../../../src/features/chat/components/DraftAdjustment";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { draftFixture } from "./itinerary-draft-fixture";
import type { SelectedPlace } from "../../../src/features/chat/lib/selected-places";

export function AdjustmentFixture(props: Partial<DraftAdjustmentProps>) {
  const [value, setValue] = useState(props.value ?? "");
  const [places, setPlaces] = useState(props.places ?? (props.draft ?? draftFixture).stops.map((stop) => stop.place));
  const onPlacesChange = (next: readonly SelectedPlace[]) => { setPlaces(next); props.onPlacesChange?.(next); };
  return <DraftAdjustment draft={draftFixture} candidates={[]} dict={chatDictFor("zh")} onSubmit={() => undefined} onBack={() => undefined} {...props} value={value} places={places} onChange={setValue} onPlacesChange={onPlacesChange} />;
}
