/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItineraryDraft } from "../../../src/features/chat/components/ItineraryDraft";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { emptyTravelConditions } from "../../../src/features/chat/lib/trip-conditions";
import { nativeDialogFixture } from "./dialog-fixture";
import { draftFixture } from "./itinerary-draft-fixture";

afterEach(cleanup);
nativeDialogFixture();
const dict = chatDictFor("zh");
const props = { draft: draftFixture, dict, onSave: vi.fn(), onAdjust: vi.fn() };

describe("a model suggestion preserves the supplied itinerary", () => {
  it("keeps every supplied place in caller order and marks estimates as suggestions", () => {
    render(<ItineraryDraft {...props} />);
    const stops = within(screen.getByRole("list", { name: "建议游览顺序" }));
    expect(stops.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["須賀神社 男坂", "参宮橋 1号踏切"]);
    expect(screen.getByText("2 个地点")).toBeTruthy();
    expect(screen.queryByText("建议停留约 20–40 分钟")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "地点详情: 須賀神社 男坂" }));
    expect(screen.getByText("建议停留约 20–40 分钟")).toBeTruthy();
    expect(screen.getByText("顺序与停留时间仅供参考，实际交通耗时尚未核实。")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("time")).toBeNull();
  });

  it("shows assumptions separately without filling in undecided user conditions", () => {
    render(<ItineraryDraft {...props} draft={{ ...draftFixture, conditions: emptyTravelConditions, assumptions: ["先只给游览顺序。"], stops: draftFixture.stops.map((stop) => ({ ...stop, stayEstimate: undefined })) }} />);
    expect(screen.queryByText("从 四谷站 出发")).toBeNull();
    expect(screen.queryByText(/建议停留/u)).toBeNull();
    expect(within(screen.getByRole("complementary", { name: "这版先按这些来安排" })).getByText("先只给游览顺序。")).toBeTruthy();
  });

  it("opens every viewpoint and browses its frames without changing the draft", () => {
    const onSave = vi.fn(), onAdjust = vi.fn();
    render(<ItineraryDraft {...props} onSave={onSave} onAdjust={onAdjust} />);
    const expand = screen.getByRole("button", { name: "地点详情: 須賀神社 男坂" });
    fireEvent.click(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: `${dict.search.previewScene}: 須賀神社 男坂 · 另一处已有名称` }));
    expect(screen.getByRole("dialog", { name: "須賀神社 男坂 · 另一处已有名称" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: dict.search.closePreview }));
    fireEvent.click(expand);
    fireEvent.click(screen.getByRole("button", { name: `${dict.search.previewScene}: 須賀神社 男坂` }));
    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toBe("2 / 2");
    expect(onSave).not.toHaveBeenCalled();
    expect(onAdjust).not.toHaveBeenCalled();
  });
});

describe("actions stay attached to the visible draft", () => {
  it("saves and adjusts the current id after a newer draft is supplied", () => {
    const onSave = vi.fn(), onAdjust = vi.fn();
    const { rerender } = render(<ItineraryDraft {...props} onSave={onSave} onAdjust={onAdjust} />);
    rerender(<ItineraryDraft {...props} draft={{ ...draftFixture, id: "draft-b" }} onSave={onSave} onAdjust={onAdjust} />);
    fireEvent.click(screen.getByRole("button", { name: "保存草案" }));
    fireEvent.click(screen.getByRole("button", { name: "调整一下" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("draft-b");
    expect(onAdjust).toHaveBeenCalledExactlyOnceWith("draft-b");
  });

  it("keeps the previous draft available while a revision is pending", () => {
    const onSave = vi.fn(), onAdjust = vi.fn();
    render(<ItineraryDraft {...props} revision={{ state: "updating" }} onSave={onSave} onAdjust={onAdjust} />);
    expect(screen.getByRole("status").textContent).toBe("正在调整，你可以继续看这版。");
    expect(screen.getByRole("heading", { name: "須賀神社 男坂" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存草案" }));
    fireEvent.click(screen.getByRole("button", { name: "调整一下" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith("draft-a");
    expect(onAdjust).not.toHaveBeenCalled();
  });

  it("retries a failed revision without replacing the readable draft", () => {
    const onRetry = vi.fn();
    render(<ItineraryDraft {...props} revision={{ state: "failed", onRetry }} />);
    expect(screen.getByRole("status").textContent).toBe("这次调整没完成，上一版还在。");
    fireEvent.click(screen.getByRole("button", { name: "再试一次" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "参宮橋 1号踏切" })).toBeTruthy();
  });
});
