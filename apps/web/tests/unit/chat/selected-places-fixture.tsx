import { useState } from "react";
import { vi } from "vitest";
import { SelectedPlacesList } from "../../../src/features/chat/components/SelectedPlacesList";
import type { SelectedPlacesListProps } from "../../../src/features/chat/components/SelectedPlacesList";
import type { SelectedPlace } from "../../../src/features/chat/lib/selected-places";
import { chatDictFor } from "../../../src/features/chat/i18n";

export const reviewPlaces = [
  { id: "a", name: "宇治橋", viewpoints: [{ id: "a1", name: "橋上", frames: [{ id: "1", url: "/a.webp" }, { id: "2", url: "/b.webp" }] }, { id: "a2", name: "橋下", frames: [{ id: "3", url: "/c.webp" }] }] },
  { id: "b", name: "宇治神社", viewpoints: [{ id: "b1", frames: [{ id: "4", url: "/d.webp" }] }] },
] as const satisfies readonly SelectedPlace[];

export function ReviewFixture({ places: initial = reviewPlaces, onChange = vi.fn(), ...props }: Partial<SelectedPlacesListProps>) {
  const [places, setPlaces] = useState(initial);
  return <SelectedPlacesList dict={chatDictFor("zh")} onBack={vi.fn()} {...props} places={places} onChange={(next) => { setPlaces(next); onChange(next); }} />;
}
