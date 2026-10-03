/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionJourney } from "../../../src/features/chat/components/SelectionJourney";
import { ChatActionsProvider } from "../../../src/features/chat/ChatActions";
import { attachReady } from "./basemap-fixture";
import { chatDictFor } from "../../../src/features/chat/i18n";
import type { SearchSpot } from "../../../src/features/chat/lib/spot-clusters";

afterEach(cleanup);
const dict = chatDictFor("zh");

/** Two regions over 50 km apart, one long place name; every spot is located. */
const spots: readonly SearchSpot[] = [
  { id: "uji-bridge", name: "宇治橋", screenshotUrl: "/uji.webp", ep: 8, city: "宇治市", coord: { lat: 34.893, lng: 135.8077 } },
  { id: "keihan-uji", name: "京阪宇治駅", ep: 5, city: "宇治市", coord: { lat: 34.8945, lng: 135.8079 } },
  { id: "suga", name: "須賀神社 男坂（新宿区須賀町の長い石段）", screenshotUrl: "/suga.webp", ep: 1, city: "新宿区", coord: { lat: 35.685, lng: 139.72 } },
  { id: "yotsuya", name: "四ツ谷駅", ep: 1, city: "新宿区", coord: { lat: 35.686, lng: 139.73 } },
];

function renderJourney() {
  const onContinue = vi.fn();
  render(<SelectionJourney spots={spots} dict={dict} attach={attachReady} onContinue={onContinue} />);
  return onContinue;
}

const pick = (name: string) => screen.getByRole("checkbox", { name: `选择这个圣地: ${name}` });
const bubble = (city: string) => screen.getByRole("button", { name: new RegExp(city) });
const summary = () => screen.getByRole("status").textContent;
const cardSelected = (name: string) => {
  const card = [...document.querySelectorAll("li.chat-spot-card")].find((item) => item.textContent.includes(name));
  return card?.getAttribute("data-selected");
};

describe("composed discovery-to-selection journey", () => {
  it("walks region discovery into the selection workspace", () => {
    renderJourney();
    expect(bubble("宇治市")).toBeTruthy();
    fireEvent.click(bubble("新宿区"));
    expect(screen.getByRole("button", { name: "照片" })).toBeTruthy();
    expect(pick("須賀神社 男坂（新宿区須賀町の長い石段）")).toBeTruthy();
  });

  it("shows a photo selection on the map markers and the summary", () => {
    renderJourney();
    fireEvent.click(bubble("新宿区"));
    fireEvent.click(pick("須賀神社 男坂（新宿区須賀町の長い石段）"));
    expect(summary()).toBe("已选 1 个地点");
    fireEvent.click(screen.getByRole("button", { name: "地图" }));
    fireEvent.click(screen.getByRole("button", { name: "須賀神社 男坂（新宿区須賀町の長い石段）" }));
    expect(pick("須賀神社 男坂（新宿区須賀町の長い石段）").getAttribute("aria-checked")).toBe("true");
  });

  it("selects from a map marker back into the photo cards", () => {
    renderJourney();
    fireEvent.click(bubble("新宿区"));
    fireEvent.click(screen.getByRole("button", { name: "地图" }));
    fireEvent.click(screen.getByRole("button", { name: "四ツ谷駅" }));
    fireEvent.click(pick("四ツ谷駅"));
    fireEvent.click(screen.getByRole("button", { name: "照片" }));
    expect(cardSelected("四ツ谷駅")).toBe("true");
    expect(summary()).toBe("已选 1 个地点");
  });

  it("keeps the selection when returning to the region overview", () => {
    renderJourney();
    fireEvent.click(bubble("新宿区"));
    fireEvent.click(pick("須賀神社 男坂（新宿区須賀町の長い石段）"));
    fireEvent.click(screen.getByRole("button", { name: "← 返回全部区域" }));
    expect(bubble("宇治市")).toBeTruthy();
    expect(summary()).toBe("已选 1 个地点");
  });
});

describe("review list wiring", () => {
  it("removing a place in review updates the summary and every surface", () => {
    const onContinue = renderJourney();
    fireEvent.click(bubble("新宿区"));
    fireEvent.click(pick("須賀神社 男坂（新宿区須賀町の長い石段）"));
    fireEvent.click(pick("四ツ谷駅"));
    fireEvent.click(screen.getByRole("button", { name: "查看所选" }));
    fireEvent.click(screen.getByRole("button", { name: "移除地点: 四ツ谷駅" }));
    fireEvent.click(screen.getByRole("button", { name: "返回浏览" }));
    expect(summary()).toBe("已选 1 个地点");
    expect(cardSelected("四ツ谷駅")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "继续规划" }));
    expect(onContinue).toHaveBeenCalledWith(["suga"]);
  });

  it("undoing a review removal re-selects the place", () => {
    renderJourney();
    fireEvent.click(bubble("新宿区"));
    fireEvent.click(pick("須賀神社 男坂（新宿区須賀町の長い石段）"));
    fireEvent.click(screen.getByRole("button", { name: "查看所选" }));
    fireEvent.click(screen.getByRole("button", { name: "移除地点: 須賀神社 男坂（新宿区須賀町の長い石段）" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    fireEvent.click(screen.getByRole("button", { name: "返回浏览" }));
    expect(summary()).toBe("已选 1 个地点");
    expect(cardSelected("須賀神社 男坂（新宿区須賀町の長い石段）")).toBe("true");
  });
});

describe("journey entry shapes", () => {
  it("skips region discovery when every spot shares one area", () => {
    render(<SelectionJourney spots={spots.slice(0, 2)} dict={dict} attach={attachReady} />);
    expect(screen.queryByRole("button", { name: /宇治市/ })).toBeNull();
    expect(pick("宇治橋")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "← 返回全部区域" })).toBeNull();
  });

  it("defaults the basemap mount while only photos are mounted", () => {
    render(<SelectionJourney spots={spots.slice(0, 2)} dict={dict} />);
    expect(pick("宇治橋")).toBeTruthy();
  });

  it("resets the drill when a fresh spot set arrives", () => {
    const view = render(<SelectionJourney spots={spots} dict={dict} attach={attachReady} />);
    fireEvent.click(bubble("新宿区"));
    view.rerender(<SelectionJourney spots={[...spots].reverse()} dict={dict} attach={attachReady} />);
    expect(bubble("宇治市")).toBeTruthy();
  });

  it("hands an empty result to the real search fallback", () => {
    render(
      <ChatActionsProvider actions={{ send: () => undefined, regenerate: () => undefined }}>
        <SelectionJourney spots={[]} dict={dict} attach={attachReady} />
      </ChatActionsProvider>,
    );
    expect(document.querySelector('[data-fallback="D2"]')).toBeTruthy();
  });
});
