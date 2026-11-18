import type { Page } from "@playwright/test";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";
import { dictFor } from "../apps/web/src/i18n/dictionaries";
import { expect, test } from "./fixtures/anonymous-visitor";
import { SSE_HEADERS, chatStreamRecording, patchSessionId } from "./fixtures/chat-stream";
import { solveTurnstileEntry } from "./helpers/turnstile";

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
const SESSION_ID = "01992000-0000-7000-8000-000000001337";
const FIRST_TURN = "宇治の聖地を2件、徒歩ルートにまとめました。";

const conversation = [
  { role: "user", content: "ユーフォ", created_at: "2026-09-05T00:00:00Z" },
  { role: "assistant", content: FIRST_TURN, created_at: "2026-09-05T00:00:01Z" },
];

async function stubConversation(page: Page, replays: string[]): Promise<void> {
  await page.route("**/v1/chat", (route) =>
    route.fulfill({ status: 200, headers: SSE_HEADERS, body: patchSessionId(chatStreamRecording("search"), SESSION_ID) }),
  );
  await page.route(`**/v1/conversations/${SESSION_ID}/messages`, (route) => {
    replays.push(route.request().url());
    return route.fulfill({ json: { messages: conversation, revision: 1, next_offset: null } });
  });
}

test("a trip to settings and back keeps the conversation, in one document", async ({ page, anonymousVisitor }) => {
  let documentLoads = 0;
  page.on("domcontentloaded", () => { documentLoads += 1; });
  const replays: string[] = [];
  await stubConversation(page, replays);
  await anonymousVisitor.enterChat();
  await expect(page.getByRole("textbox")).toBeVisible();

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
  await expect(page.locator(".chat-message--user").getByText("ユーフォ", { exact: true })).toBeVisible();
  expect(replays).toHaveLength(1);
  expect(documentLoads).toBe(1);
});
