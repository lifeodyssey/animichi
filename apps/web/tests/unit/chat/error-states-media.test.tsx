/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MapFallback } from "../../../src/features/chat/components/ErrorStates/MapFallback";
import { SceneThumb } from "../../../src/features/chat/components/ErrorStates/SceneThumb";
import { chatDictFor } from "../../../src/features/chat/i18n";

afterEach(cleanup);

const ja = chatDictFor("ja");

describe("SceneThumb (D9 scene image 404)", () => {
  it("renders the scene image while the source is healthy", () => {
    render(<SceneThumb src="/scenes/ok.webp" alt="宇治橋" ep={8} dict={ja} />);
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("宇治橋");
  });

  it("degrades to a gradient placeholder with the episode label when the image 404s", () => {
    render(<SceneThumb src="/scenes/gone.webp" alt="宇治橋" ep={8} dict={ja} />);
    fireEvent.error(screen.getByRole("img", { name: "宇治橋" }));
    expect(screen.getByText("第8話")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "宇治橋" })).toBeTruthy();
  });

  it("shows the placeholder immediately when the row has no image at all", () => {
    render(<SceneThumb alt="宇治橋" ep={3} dict={ja} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("第3話")).toBeTruthy();
  });

  it("keeps the placeholder accessible when the episode is unknown", () => {
    render(<SceneThumb alt="宇治橋" dict={ja} />);
    expect(screen.getByRole("img", { name: "宇治橋" })).toBeTruthy();
    expect(screen.queryByText(/第.*話/u)).toBeNull();
  });

  it("localises the episode label per locale", () => {
    render(<SceneThumb alt="Uji Bridge" ep={8} dict={chatDictFor("en")} />);
    expect(screen.getByText("Ep. 8")).toBeTruthy();
  });

  it("retries the image when a later render corrects the source", () => {
    const view = render(<SceneThumb src="/scenes/gone.webp" alt="宇治橋" ep={8} dict={ja} />);
    fireEvent.error(screen.getByRole("img", { name: "宇治橋" }));
    expect(document.querySelector("img")).toBeNull();
    view.rerender(<SceneThumb src="/scenes/fixed.webp" alt="宇治橋" ep={8} dict={ja} />);
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/scenes/fixed.webp");
  });
});

describe("MapFallback (D7 map failure)", () => {
  it("renders the in-character message and an external map app link", () => {
    render(<MapFallback dict={ja} lat={34.89} lng={135.8} />);
    expect(screen.getByText(ja.errorStates.d7Message)).toBeTruthy();
    const link = screen.getByRole("link", { name: ja.errorStates.d7Open });
    expect(link.getAttribute("href")).toContain("34.89,135.8");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("keeps the illustration decorative and drops the link without coordinates", () => {
    render(<MapFallback dict={ja} />);
    expect(screen.getByText(ja.errorStates.d7Message)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
