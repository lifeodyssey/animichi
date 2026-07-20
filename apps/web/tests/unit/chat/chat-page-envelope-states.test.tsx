/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { setLanguages } from "../_i18n";
import { chatStreamHandler, chatStreamPatchedHandler } from "../../msw/chat-handlers";
import type { FinalFramePatch } from "../../msw/chat-handlers";
import { server } from "../../msw/node";
import { renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");
const states = ja.errorStates;

beforeEach(() => {
  setLanguages(["ja"]);
});

function sendText(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: ja.send }));
}

function failedEnvelopePatch(code: string, technical: string): FinalFramePatch {
  return () => ({ intent: "error", success: false, status: "error", errors: [{ code, message: technical }] });
}

const zeroSpotsPatch: FinalFramePatch = (envelope) => ({
  ...envelope,
  data: { route: { ordered_points: [], point_count: 0 } },
});

const BROKEN_SCENE_POINT = {
  id: "p1",
  name: "宇治橋",
  bangumi_id: "12345",
  episode: 8,
  latitude: 34.891,
  longitude: 135.807,
  screenshot_url: "/broken/scene.webp",
};

const brokenScenePatch: FinalFramePatch = (envelope) => ({
  ...envelope,
  data: { route: { ordered_points: [BROKEN_SCENE_POINT], point_count: 2 } },
});

describe("D1 recognition failure", () => {
  it("renders the apology card with hints and the example chips again", async () => {
    server.use(chatStreamPatchedHandler("search", failedEnvelopePatch("anime_not_found", "resolver miss")));
    renderChatPage();
    sendText("知らない作品");
    expect(await screen.findByText(states.d1Title)).toBeTruthy();
    expect(screen.getByText(states.d1Subtitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: ja.chips[0] })).toBeTruthy();
    expect(screen.queryByText("resolver miss")).toBeNull();
  });
});

describe("D2 zero pilgrimage spots", () => {
  it("renders the no-spots copy with neighbouring suggestions", async () => {
    server.use(chatStreamPatchedHandler("search", zeroSpotsPatch));
    renderChatPage();
    sendText("マイナー作品");
    expect(await screen.findByText(states.d2Title)).toBeTruthy();
    expect(screen.getByRole("button", { name: ja.chips[1] })).toBeTruthy();
  });
});

describe("D3 short route", () => {
  it("keeps the spot cards and proposes adding a nearby work", async () => {
    server.use(chatStreamHandler("search"));
    renderChatPage();
    sendText("ユーフォ");
    expect(await screen.findByText(states.d3Notice)).toBeTruthy();
    expect(screen.getByText("宇治橋")).toBeTruthy();
    expect(screen.getByRole("button", { name: states.d3Chip })).toBeTruthy();
  });
});

describe("D6 validation rejection", () => {
  it("renders only the in-character apology, never the technical detail", async () => {
    const technical = "ModelRetry exhausted after output_validator rejection";
    server.use(chatStreamPatchedHandler("search", failedEnvelopePatch("output_validation_failed", technical)));
    renderChatPage();
    sendText("ユーフォ");
    expect(await screen.findByText(states.d6Message)).toBeTruthy();
    expect(screen.queryByText(/ModelRetry/)).toBeNull();
    expect(screen.queryByText(/output_validator/)).toBeNull();
    expect(screen.getByRole("button", { name: states.d6Retry })).toBeTruthy();
  });

  it("retries the turn from the apology card", async () => {
    server.use(chatStreamPatchedHandler("search", failedEnvelopePatch("output_validation_failed", "rejected")));
    renderChatPage();
    sendText("ユーフォ");
    await screen.findByText(states.d6Message);
    server.use(chatStreamHandler("search"));
    fireEvent.click(screen.getByRole("button", { name: states.d6Retry }));
    expect(await screen.findByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeTruthy();
  });
});

describe("D9 scene image 404", () => {
  it("degrades the scene thumb to a gradient placeholder with the episode label", async () => {
    server.use(chatStreamPatchedHandler("search", brokenScenePatch));
    renderChatPage();
    sendText("ユーフォ");
    const img = await screen.findByRole("img", { name: "宇治橋" });
    fireEvent.error(img);
    expect(screen.getByText("第8話")).toBeTruthy();
    expect(document.querySelector("img.chat-scene-thumb")).toBeNull();
  });
});
