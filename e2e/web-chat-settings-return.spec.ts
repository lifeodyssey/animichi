import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";
import { dictFor } from "../apps/web/src/i18n/dictionaries";
import { SSE_HEADERS, chatStreamRecording, patchSessionId } from "./fixtures/chat-stream";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";

/**
 * Issue #1337 (audit web-H2): a mid-conversation trip to the settings page used
 * to be a document load against a URL that never carried the session id, so the
 * visitor came back to an empty draft with the conversation stranded on the
 * backend. The chat now publishes its id into `?session=` and both legs are
 * router links, so the round trip stays in one document and comes back to the
 * same conversation.
 */
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  locale: "ja-JP",
});

const ja = chatDictFor("ja");
const settings = dictFor("ja").settings;
const SESSION_ID = "s-1337";
const FIRST_TURN = "宇治の聖地を2件、徒歩ルートにまとめました。";

const conversation = [
  { role: "user", content: "ユーフォ", created_at: "2026-09-05T00:00:00Z" },
  { role: "assistant", content: FIRST_TURN, created_at: "2026-09-05T00:00:01Z" },
];

async function openChat(page: Page): Promise<void> {
  await stubTurnstileEntry(page);
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const hydrated = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat");
  await solveTurnstileEntry(page);
  await hydrated;
  await expect(page.getByRole("textbox")).toBeVisible();
}

async function stubConversation(page: Page, replays: string[]): Promise<void> {
  await page.route("**/v1/chat", (route) =>
    route.fulfill({ status: 200, headers: SSE_HEADERS, body: patchSessionId(chatStreamRecording("search"), SESSION_ID) }),
  );
  await page.route(`**/v1/conversations/${SESSION_ID}/messages`, (route) => {
    replays.push(route.request().url());
    return route.fulfill({ json: { messages: conversation, revision: 1, next_offset: null } });
  });
}

test("a trip to settings and back keeps the conversation, in one document", async ({ page }) => {
  let documentLoads = 0;
  page.on("domcontentloaded", () => { documentLoads += 1; });
  const replays: string[] = [];
  await stubConversation(page, replays);
  await openChat(page);

  await page.getByRole("textbox").fill("ユーフォ");
  await page.getByRole("button", { name: ja.send }).click();
  await expect(page.getByText(FIRST_TURN)).toBeVisible();
  // The assigned id reaches the address bar, which is what makes the trip survivable.
  await expect(page).toHaveURL(new RegExp(`[?&]session=${SESSION_ID}(&|$)`, "u"));

  await page.getByRole("link", { name: ja.appbar.settings }).click();
  await expect(page.getByRole("heading", { level: 1, name: settings.title })).toBeVisible();
  // The settings leg has to carry the id too, or the way back has nothing to resume.
  await expect(page).toHaveURL(new RegExp(`[?&]session=${SESSION_ID}(&|$)`, "u"));

  await page.getByRole("link", { name: settings.backToChat }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]session=${SESSION_ID}(&|$)`, "u"));
  await solveTurnstileEntry(page);
  await expect(page.getByText(FIRST_TURN)).toBeVisible();
  await expect(page.getByText("ユーフォ")).toBeVisible();
  expect(replays).toHaveLength(1);
  expect(documentLoads).toBe(1);
});
