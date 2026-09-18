import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";
import { SSE_HEADERS, chatStreamRecording, patchFinalFrame } from "./fixtures/chat-stream";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";

/**
 * Issue #273 (S1.7) Task 1 browser ACs — the E2 selection tray and the
 * `selected_point_ids` selection turn. Streams are the real agent recordings,
 * patched with the same discipline as the D-state variants: the search body's
 * final envelope becomes a search_bangumi result set, and the recompute body
 * is the recording with its agent tool frames stripped and the typed turn's
 * `plan_selected` step pair injected in their place.
 */
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  locale: "ja-JP",
});

const ja = chatDictFor("ja");

const searchResultsBody = patchFinalFrame(chatStreamRecording("search"), (envelope) => ({
  ...envelope,
  intent: "search_bangumi",
  data: {
    results: {
      rows: [
        { id: "p1", name: "宇治橋", latitude: 34.891, longitude: 135.807 },
        { id: "p2", name: "京阪宇治駅", latitude: 34.911, longitude: 135.806 },
        { id: "p3", name: "宇治神社", latitude: 34.9, longitude: 135.81 },
      ],
    },
  },
}));

/** The real wire shape of a selection turn: `plan_selected` emits a
 * running/done step pair, translated by `chat_stream` into these tool chunks.
 * Since TURN-4 #955 deleted the bypass's suppression contract, the step is
 * part of the turn's visible activity — it streams as a badge and settles
 * behind the turn's footprint, which is exactly what the fixture lets us pin.
 * The opening chunk carries `toolMetadata.origin` because the edge's
 * `serverStepOpened` does (#1462); SD-9 declares that slot free-form, so the
 * UI reads straight past it and the shape this spec checks is unchanged. */
const planSelectedStepFrames = [
  'data: {"type":"tool-input-start","toolCallId":"plan_selected-fixture","toolName":"plan_selected","toolMetadata":{"origin":"server"}}',
  'data: {"type":"tool-input-available","toolCallId":"plan_selected-fixture","toolName":"plan_selected","input":{}}',
  'data: {"type":"tool-output-available","toolCallId":"plan_selected-fixture","output":{"point_count":2}}',
].join("\n\n");

const recomputeBody = chatStreamRecording("search")
  .split("\n")
  .filter((line) => !line.startsWith('data: {"type":"tool-'))
  .join("\n")
  .replace('data: {"type":"start-step"}', `data: {"type":"start-step"}\n\n${planSelectedStepFrames}`)
  .replaceAll('"intent":"plan_route"', '"intent":"plan_selected"');

async function openChat(page: Page): Promise<void> {
  await stubTurnstileEntry(page);
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const hydrated = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat");
  await solveTurnstileEntry(page);
  await hydrated;
}

interface SentBody {
  readonly selected_point_ids?: readonly string[];
}

async function searchThenTickTwo(page: Page, bodies: SentBody[], failRecompute = false): Promise<void> {
  let calls = 0;
  await page.route("**/v1/chat", (route) => {
    bodies.push(route.request().postDataJSON() as SentBody);
    calls += 1;
    if (calls === 1) return route.fulfill({ status: 200, headers: SSE_HEADERS, body: searchResultsBody });
    if (failRecompute) return route.fulfill({ status: 500, body: "" });
    return route.fulfill({ status: 200, headers: SSE_HEADERS, body: recomputeBody });
  });
  await openChat(page);
  await page.getByRole("textbox").fill("ユーフォ");
  await page.getByRole("button", { name: ja.send }).click();
  // Exact: the spot name also appears inside the pick checkbox's sr-only
  // accessible label (`この聖地をえらぶ: 宇治橋`), so a substring match
  // resolves to 2 elements. The assertion is about the visible card name.
  await expect(page.getByText("宇治橋", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: `${ja.search.select}: 宇治橋` }).check();
  await page.getByRole("checkbox", { name: `${ja.search.select}: 宇治神社` }).check();
}

test("ticking two spots surfaces the tray; the recompute settles behind a footprint with its card", async ({ page }) => {
  const bodies: SentBody[] = [];
  await searchThenTickTwo(page, bodies);
  await expect(page.getByText(ja.search.traySelected.replace("{count}", "2"))).toBeVisible();
  await page.getByRole("button", { name: ja.search.trayAction }).click();
  const recomputeCard = page.locator('article[data-intent="plan_selected"]');
  await expect(recomputeCard).toBeVisible();
  // Structural enumeration of the settled recompute turn: since TURN-4 #955
  // the turn streams its plan_selected step like any other, and #1529 folded
  // the recompute footprint into the generic settled one — so the turn row
  // carries one settled footprint (labelled with the generic activity copy)
  // holding that step, the card beside it, and no skeleton. Not time-sampled.
  const turn = page.locator("li.chat-message--assistant", { has: recomputeCard });
  const footprint = turn.locator(".chat-settled");
  await expect(footprint).toHaveCount(1);
  await expect(footprint.locator(".chat-settled__summary")).toContainText(ja.footprintDetails);
  await expect(turn.locator(".chat-step")).toHaveCount(1);
  await expect(turn.locator(".chat-settled .chat-step")).toHaveCount(1);
  await expect(turn.locator(".chat-card--skeleton")).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]?.selected_point_ids).toEqual(["p1", "p3"]);
});

test("a failed recompute retries inline on the tray and never escalates to TurnFailure", async ({ page }) => {
  const bodies: SentBody[] = [];
  await searchThenTickTwo(page, bodies, true);
  await page.getByRole("button", { name: ja.search.trayAction }).click();
  await expect(page.getByRole("button", { name: ja.search.trayRetry })).toBeVisible();
  // The selection and the prior card survive; no full-page D4 surface appears.
  await expect(page.getByText(ja.errorStates.d4Message)).toHaveCount(0);
  await expect(page.getByText("宇治橋", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `${ja.search.select}: 宇治橋` })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: `${ja.search.select}: 宇治神社` })).toBeChecked();
});
