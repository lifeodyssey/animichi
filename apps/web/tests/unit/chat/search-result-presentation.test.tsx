/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SearchResult } from "../../../src/features/chat/components/SearchResult";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { SpotSelectionProvider, useSpotSelectionState } from "../../../src/features/chat/selection/use-spot-selection";
import type { SearchSpot } from "../../../src/features/chat/lib/spot-clusters";
import type { AttachBasemap } from "../../../src/features/chat/components/SearchMap";
import { nativeDialogFixture } from "./dialog-fixture";

afterEach(cleanup);
nativeDialogFixture();
const dict = chatDictFor("ja");
const attach: AttachBasemap = ({ onStatus }) => { onStatus("ready"); return () => undefined; };
const spot: SearchSpot = { id: "bridge", name: "宇治橋", ep: 8, city: "宇治市", coord: { lat: 34.891, lng: 135.807 } };

function Harness({ screenshotUrl }: Readonly<{ screenshotUrl?: string }>) {
  const selection = useSpotSelectionState();
  return <SpotSelectionProvider selection={selection}><SearchResult spots={[{ ...spot, screenshotUrl }]} dict={dict} attach={attach} /></SpotSelectionProvider>;
}

describe("search result selection and imagery", () => {
  it("previews the image independently and preserves the selected place on close", () => {
    render(<Harness screenshotUrl="/bridge.webp" />);
    fireEvent.click(screen.getByRole("checkbox"));
    const trigger = screen.getByRole("button", { name: `${dict.search.previewScene}: ${spot.name}` });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: spot.name });
    expect(within(dialog).getByRole("img", { name: spot.name }).getAttribute("src")).toBe("/bridge.webp");
    const close = within(dialog).getByRole("button", { name: dict.search.closePreview });
    close.focus();
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("checkbox", { checked: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox", { checked: false })).toBeTruthy();
  });

  it("does not select a place just because its scene or name was clicked", () => {
    render(<Harness screenshotUrl="/bridge.webp" />);
    fireEvent.click(screen.getByRole("button", { name: `${dict.search.previewScene}: ${spot.name}` }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    fireEvent.click(screen.getByText(spot.name));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("checkbox", { checked: false })).toBeTruthy();
  });

});

describe("search result missing and changed imagery", () => {
  it("shows the episode once without an empty image placeholder", () => {
    render(<Harness />);
    expect(screen.getAllByText(/第8話/u)).toHaveLength(1);
    expect(screen.queryByRole("img", { name: spot.name })).toBeNull();
  });

  it("keeps a failed photo's place selectable without duplicating its episode", () => {
    render(<Harness screenshotUrl="/missing.webp" />);
    fireEvent.error(screen.getByRole("img", { name: spot.name }));
    expect(screen.queryByRole("img", { name: spot.name })).toBeNull();
    expect(screen.getAllByText(/第8話/u)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: `${dict.search.previewScene}: ${spot.name}` })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox", { checked: true })).toBeTruthy();
  });

  it("shows a new photo arriving after a failed one without losing the selection", () => {
    const view = render(<Harness screenshotUrl="/missing.webp" />);
    fireEvent.error(screen.getByRole("img", { name: spot.name }));
    fireEvent.click(screen.getByRole("checkbox"));
    view.rerender(<Harness screenshotUrl="/new.webp" />);
    expect(screen.getByRole("img", { name: spot.name }).getAttribute("src")).toBe("/new.webp");
    expect(screen.getByRole("checkbox", { checked: true })).toBeTruthy();
  });
});
