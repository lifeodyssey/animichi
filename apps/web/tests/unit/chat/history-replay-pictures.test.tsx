/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryList } from "../../../src/features/chat/components/HistoryList";
import type { HistoryReplayEntry } from "../../../src/features/chat/lib/history-replay";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { draftFixture } from "./itinerary-draft-fixture";
import { nativeDialogFixture } from "./dialog-fixture";

nativeDialogFixture();
afterEach(cleanup);
const dict = chatDictFor("zh");
const entries: readonly HistoryReplayEntry[] = [{ id: "pictures", role: "assistant", content: "上次看到的画面。", blocks: [{ id: "scenes", kind: "scenes", places: [draftFixture.stops[0].place] }] }];

describe("historical pictures preserve reading state", () => {
  it("opens the existing frame gallery without presenting selection controls", () => {
    const onContinueDraft = vi.fn();
    render(<HistoryList entries={entries} dict={dict} onContinueDraft={onContinueDraft} />);
    fireEvent.click(screen.getByRole("button", { name: "查看大图: 須賀神社 男坂" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("1 / 2");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(onContinueDraft).not.toHaveBeenCalled();
  });

  it("keeps an open gallery through a refresh and closes it when the session changes", () => {
    const { rerender } = render(<HistoryList entries={entries} dict={dict} sessionId="session-a" status="success" />);
    fireEvent.click(screen.getByRole("button", { name: "查看大图: 須賀神社 男坂" }));
    rerender(<HistoryList entries={entries} dict={dict} sessionId="session-a" status="loading" />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    rerender(<HistoryList entries={entries} dict={dict} sessionId="session-b" status="success" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("上次看到的画面。")).toBeTruthy();
  });

  it("keeps the place name when an image fails", () => {
    render(<HistoryList entries={entries} dict={dict} />);
    fireEvent.error(screen.getByRole("img", { name: "須賀神社 男坂" }));
    expect(screen.getByRole("heading", { name: "須賀神社 男坂" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "暂无场景图片" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "查看大图: 須賀神社 男坂" })).toBeNull();
  });
});
