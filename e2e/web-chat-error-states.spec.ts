import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";
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
  data: { route: { ordered_points: [], point_count: 0 } },
});

const brokenScene: EnvelopePatch = (envelope) => ({
  ...envelope,
  data: {
    route: {
      ordered_points: [
        { id: "p1", name: "宇治橋", bangumi_id: "12345", episode: 8, latitude: 34.891, longitude: 135.807, screenshot_url: "/broken/scene.webp" },
      ],
      point_count: 2,
    },
  },
});

async function fulfillSse(route: Route, body: string): Promise<void> {
  await route.fulfill({ status: 200, headers: SSE_HEADERS, body });
}

/** The healthz probe only fires from the hydrated client, so awaiting it
 * guarantees the composer's React handlers are attached before interacting. */
async function openChat(page: Page): Promise<void> {
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const hydrated = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat");
  await hydrated;
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox").fill(text);
  await page.getByRole("button", { name: ja.send }).click();
}

async function routeChatStream(page: Page, body: string): Promise<void> {
  await page.route("**/v1/chat", (route) => fulfillSse(route, body));
}

test("D1 recognition failure renders the apology card with suggestion chips", async ({ page }) => {
  await routeChatStream(page, patchFinalFrame(chatStreamRecording("search"), failedEnvelope("anime_not_found")));
  await openChat(page);
  await send(page, "知らない作品");
  await expect(page.getByText(states.d1Title)).toBeVisible();
  await expect(page.getByText(states.d1Subtitle)).toBeVisible();
  await expect(page.getByRole("button", { name: ja.chips[0] })).toBeVisible();
});

test("D2 zero spots renders the no-spots copy with recommendations", async ({ page }) => {
  await routeChatStream(page, patchFinalFrame(chatStreamRecording("search"), zeroSpots));
  await openChat(page);
  await send(page, "マイナー作品");
  await expect(page.getByText(states.d2Title)).toBeVisible();
  await expect(page.getByRole("button", { name: ja.chips[1] })).toBeVisible();
});

test("D3 short route keeps the spot cards and proposes widening", async ({ page }) => {
  await routeChatStream(page, chatStreamRecording("search"));
  await openChat(page);
  await send(page, "ユーフォ");
  await expect(page.getByText(states.d3Notice)).toBeVisible();
  await expect(page.getByText("宇治橋")).toBeVisible();
  await expect(page.getByRole("button", { name: states.d3Chip })).toBeVisible();
});

test("D4 interruption before the first chunk shows a retry entry, not a stuck spinner", async ({ page }) => {
  await page.route("**/v1/chat", (route) => route.abort("connectionreset"));
  await openChat(page);
  await send(page, "ユーフォ");
  await expect(page.getByText(states.d4Message)).toBeVisible();
  await expect(page.getByRole("button", { name: states.d4Retry })).toBeVisible();
  await expect(page.locator(".chat-typing")).toHaveCount(0);
  await expect(page.getByText("ユーフォ")).toBeVisible();
});

test("D4 recovery re-reads the session's final state and preserves the conversation", async ({ page }) => {
  await routeChatStream(page, patchSessionId(chatStreamRecording("search"), "s-e2e"));
  await openChat(page);
  await send(page, "ユーフォ");
  await expect(page.getByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeVisible();
  await page.route("**/v1/chat", (route) => route.abort("connectionreset"));
  await send(page, "続きも教えて");
  await expect(page.getByText(states.d4Message)).toBeVisible();
  await page.route("**/v1/conversations/s-e2e/messages", (route) =>
    route.fulfill({
      json: {
        messages: [
          { role: "user", content: "ユーフォ" },
          { role: "assistant", content: "宇治の聖地を2件、徒歩ルートにまとめました。" },
          { role: "user", content: "続きも教えて" },
          { role: "assistant", content: "つづきはこの2か所だよ。" },
        ],
      },
    }),
  );
  await page.getByRole("button", { name: states.d4Retry }).click();
  await expect(page.getByText("つづきはこの2か所だよ。")).toBeVisible();
  await expect(page.getByText(states.d4Message)).toHaveCount(0);
  await expect(page.getByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeVisible();
});

test("D5 timeout swaps the stuck turn for the same-shape retry", async ({ page }) => {
  await page.route("**/v1/chat", () => {
    /* never respond: the turn hangs until the watchdog stops it */
  });
  await openChat(page);
  await page.clock.install();
  await send(page, "ユーフォ");
  await expect(page.locator(".chat-typing")).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(page.getByText(states.d5Message)).toBeVisible();
  await expect(page.getByRole("button", { name: states.d5Retry })).toBeVisible();
});

test("D6 validation rejection apologises without leaking technical detail", async ({ page }) => {
  await routeChatStream(page, patchFinalFrame(chatStreamRecording("search"), failedEnvelope("output_validation_failed")));
  await openChat(page);
  await send(page, "ユーフォ");
  await expect(page.getByText(states.d6Message)).toBeVisible();
  await expect(page.getByRole("button", { name: states.d6Retry })).toBeVisible();
  await expect(page.getByText(/ModelRetry|output_validator/)).toHaveCount(0);
});

test("D8 session expiry preserves the conversation and resumes in place", async ({ page }) => {
  await page.route("**/v1/chat", (route) => route.fulfill({ status: 401, body: "" }));
  await openChat(page);
  await send(page, "こんにちは");
  await expect(page.getByText(states.d8Message)).toBeVisible();
  await expect(page.getByText("こんにちは")).toBeVisible();
  await expect(page.getByRole("button", { name: states.d8Login })).toBeVisible();
  await expect(page.getByRole("button", { name: states.d8Resume })).toBeVisible();
});

test("D9 scene image 404 degrades to a gradient placeholder with the episode label", async ({ page }) => {
  await page.route("**/broken/scene.webp", (route) => route.fulfill({ status: 404, body: "" }));
  await routeChatStream(page, patchFinalFrame(chatStreamRecording("search"), brokenScene));
  await openChat(page);
  await send(page, "ユーフォ");
  await expect(page.getByText("第8話")).toBeVisible();
  await expect(page.locator("img.chat-scene-thumb")).toHaveCount(0);
});
