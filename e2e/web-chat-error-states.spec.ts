import type { Page, Route } from "@playwright/test";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";
import { waitingCopy } from "../apps/web/src/features/chat/waiting-copy";
import { expect, test } from "./fixtures/anonymous-visitor";
import { SSE_HEADERS, chatStreamRecording, patchFinalFrame, patchSessionId } from "./fixtures/chat-stream";
import type { EnvelopePatch } from "./fixtures/chat-stream";

/**
 * Issue #272 (S1.6) browser ACs: each simulated D-state trigger renders its
 * prescribed in-character fallback — never a bare error or a blank screen.
 * D7 (map failure) has no live trigger in the chat flow yet (no map card is
 * rendered there); the MapFallback component is unit-covered and this spec
 * gains a D7 case when the chat map card lands.
 */
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  locale: "ja-JP",
});

const ja = chatDictFor("ja");
const states = ja.errorStates;

const failedEnvelope = (code: string): EnvelopePatch => () => ({
  intent: "error",
  success: false,
  status: "error",
  errors: [{ code, message: "ModelRetry exhausted after output_validator rejection" }],
});

const zeroSpots: EnvelopePatch = (envelope) => ({
  ...envelope,
  data: { itinerary: { ordered_points: [], point_count: 0 } },
});

const brokenScene: EnvelopePatch = (envelope) => ({
  ...envelope,
  data: {
    itinerary: {
      ordered_points: [
        { id: "p1", name: "宇治橋", bangumi_id: "12345", episode: 8, latitude: 34.891, longitude: 135.807, screenshot_url: "/broken/scene.webp" },
      ],
      point_count: 2,
    },
  },
});

const recoveredReply = patchFinalFrame(chatStreamRecording("search"), (envelope) => ({
  ...envelope, message: "つづきはこの2か所だよ。", session_id: "s-e2e",
}));

async function fulfillSse(route: Route, body: string): Promise<void> {
  await route.fulfill({ status: 200, headers: SSE_HEADERS, body });
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox", { name: ja.inputPlaceholder }).fill(text);
  await page.getByRole("button", { name: ja.send }).click();
}

async function routeChatStream(page: Page, body: string): Promise<void> {
  await page.route("**/v1/chat", (route) => fulfillSse(route, body));
}

test("D1 recognition failure offers an input for another title or clue", async ({ page, anonymousVisitor }) => {
  await routeChatStream(page, patchFinalFrame(chatStreamRecording("search"), failedEnvelope("anime_not_found")));
  await anonymousVisitor.enterChat();
  await send(page, "知らない作品");
  await expect(page.getByText(states.d1Title)).toBeVisible();
  await expect(page.getByText(states.d1Hint)).toBeVisible();
  await expect(page.getByRole("textbox", { name: states.d1Label })).toBeVisible();
  await expect(page.getByRole("button", { name: states.d1Submit })).toBeDisabled();
});

test("D2 zero spots offers a new title or region search", async ({ page, anonymousVisitor }) => {
  await routeChatStream(page, patchFinalFrame(chatStreamRecording("search"), zeroSpots));
  await anonymousVisitor.enterChat();
  await send(page, "マイナー作品");
  await expect(page.getByText(states.d2Title)).toBeVisible();
  await expect(page.getByRole("textbox", { name: states.d2Label })).toBeVisible();
  await expect(page.getByRole("button", { name: states.d2Submit })).toBeDisabled();
});

test("D3 short route keeps the spot cards and proposes widening", async ({ page, anonymousVisitor }) => {
  await routeChatStream(page, chatStreamRecording("search"));
  await anonymousVisitor.enterChat();
  await send(page, "ユーフォ");
  await expect(page.getByText(states.d3Notice)).toBeVisible();
  await expect(page.getByText("宇治橋")).toBeVisible();
  await expect(page.getByRole("button", { name: states.d3Chip })).toBeVisible();
});

test("D4 interruption before the first chunk shows a retry entry, not a stuck spinner", async ({ page, anonymousVisitor }) => {
  await page.route("**/v1/chat", (route) => route.abort("connectionreset"));
  await anonymousVisitor.enterChat();
  await send(page, "ユーフォ");
  await expect(page.getByText(states.d4Message)).toBeVisible();
  await expect(page.getByRole("button", { name: states.d4Retry })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: waitingCopy("ja").label })).toHaveCount(0);
  await expect(page.locator(".chat-message--user").getByText("ユーフォ", { exact: true })).toBeVisible();
});

test("D4 recovery reconnects to the session stream and preserves the conversation", async ({ page, anonymousVisitor }) => {
  const reconnects: string[] = [];
  await routeChatStream(page, patchSessionId(chatStreamRecording("search"), "s-e2e"));
  await anonymousVisitor.enterChat();
  await send(page, "ユーフォ");
  await expect(page.getByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeVisible();
  await page.route("**/v1/chat", (route) => route.abort("connectionreset"));
  await send(page, "続きも教えて");
  await expect(page.getByText(states.d4Message)).toBeVisible();
  await page.route("**/v1/conversations/s-e2e/stream*", (route) => {
    reconnects.push(route.request().method());
    return fulfillSse(route, recoveredReply);
  });
  await page.getByRole("button", { name: states.d4Retry }).click();
  await expect(page.getByText("つづきはこの2か所だよ。")).toBeVisible();
  await expect(page.getByText(states.d4Message)).toHaveCount(0);
  await expect(page.getByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeVisible();
  expect(reconnects).toEqual(["GET"]);
});

test("D5 timeout swaps the stuck turn for the same-shape retry", async ({ page, anonymousVisitor }) => {
  await page.route("**/v1/chat", () => {
    /* never respond: the turn hangs until the watchdog stops it */
  });
  await anonymousVisitor.enterChat();
  await page.clock.install();
  await send(page, "ユーフォ");
  await expect(page.getByRole("status").filter({ hasText: waitingCopy("ja").label })).toBeVisible();
  // The native view reconnects after 110 seconds without transport activity.
  await page.clock.fastForward(110_001);
  await expect(page.getByText(states.d5Message)).toBeVisible();
  await expect(page.getByRole("button", { name: states.d5Retry })).toBeVisible();
});

test("D6 validation rejection apologises without leaking technical detail", async ({ page, anonymousVisitor }) => {
  await routeChatStream(page, patchFinalFrame(chatStreamRecording("search"), failedEnvelope("output_validation_failed")));
  await anonymousVisitor.enterChat();
  await send(page, "ユーフォ");
  await expect(page.getByText(states.d6Message)).toBeVisible();
  await expect(page.getByRole("button", { name: states.d6Retry })).toBeVisible();
  await expect(page.getByText(/ModelRetry|output_validator/)).toHaveCount(0);
});

test("D8 session expiry preserves the conversation and resumes in place", async ({ page, anonymousVisitor }) => {
  await page.route("**/v1/chat", (route) => route.fulfill({ status: 401, body: "" }));
  await anonymousVisitor.enterChat();
  await send(page, "こんにちは");
  await expect(page.getByText(states.d8Message)).toBeVisible();
  await expect(page.locator(".chat-message--user").getByText("こんにちは", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: states.d8Login })).toBeVisible();
  await expect(page.getByRole("button", { name: states.d8Resume })).toBeVisible();
});

test("D9 scene image 404 preserves its slot with an accessible failure and episode label", async ({ page, anonymousVisitor }) => {
  await page.route("**/broken/scene.webp", (route) => route.fulfill({ status: 404, body: "" }));
  await routeChatStream(page, patchFinalFrame(chatStreamRecording("search"), brokenScene));
  await anonymousVisitor.enterChat();
  await send(page, "ユーフォ");
  await expect(page.getByText("第8話")).toBeVisible();
  await expect(page.getByRole("img", { name: `宇治橋 · ${states.d9Failed}` })).toBeVisible();
  await expect(page.locator("img.chat-scene-thumb")).toHaveCount(0);
});
