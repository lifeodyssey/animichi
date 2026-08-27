import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";
import { SSE_HEADERS, chatStreamRecording, patchFinalFrame } from "./fixtures/chat-stream";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";

/**
 * W1 #1220 browser ACs — the clarify → pick → results journey and its 409
 * failure variant. Streams are the real agent recordings, patched with the
 * same discipline as the selection suite: the clarify envelope carries a
 * bilingual pending selection, the pick's answer becomes a search result
 * set, and the injected 409 replays the edge's real conflict envelope.
 */
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  locale: "ja-JP",
});

const ja = chatDictFor("ja");
const HARUHI_LABEL = "凉宫春日的忧郁(涼宮ハルヒの憂鬱)";

const clarifyBody = patchFinalFrame(chatStreamRecording("clarify"), (envelope) => ({
  ...envelope,
  data: {
    reason: "anime_ambiguity",
    clarification_id: 4,
    candidates: [
      { id: "115908", title: "涼宮ハルヒの憂鬱", title_cn: "凉宫春日的忧郁" },
      { id: "117696", title: "長門有希ちゃんの消失" },
    ],
  },
}));

const resultsBody = patchFinalFrame(chatStreamRecording("search"), (envelope) => ({
  ...envelope,
  intent: "search_bangumi",
  data: {
    results: {
      rows: [
        { id: "p1", name: "西宮北高校", latitude: 34.76, longitude: 135.34 },
        { id: "p2", name: "甲陽園駅", latitude: 34.75, longitude: 135.35 },
      ],
    },
  },
}));

const CONFLICT_ENVELOPE = JSON.stringify({ error: { code: "turn_in_flight", message: "conflict" } });

async function openChat(page: Page): Promise<void> {
  await stubTurnstileEntry(page);
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const hydrated = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat");
  await solveTurnstileEntry(page);
  await hydrated;
}

interface SentTurn {
  readonly turnId: string | undefined;
  readonly selected_candidate_ids?: readonly string[];
  readonly clarification_id?: number | null;
}

async function askUntilClarify(page: Page, sent: SentTurn[], conflictOnPick = false): Promise<void> {
  let calls = 0;
  await page.route("**/v1/chat", (route) => {
    const body = route.request().postDataJSON() as Omit<SentTurn, "turnId">;
    sent.push({ ...body, turnId: route.request().headers()["x-turn-id"] });
    calls += 1;
    if (calls === 1) return route.fulfill({ status: 200, headers: SSE_HEADERS, body: clarifyBody });
    if (conflictOnPick && calls === 2) {
      return route.fulfill({ status: 409, contentType: "application/json", body: CONFLICT_ENVELOPE });
    }
    return route.fulfill({ status: 200, headers: SSE_HEADERS, body: resultsBody });
  });
  await openChat(page);
  await page.getByRole("textbox").fill("ハルヒ");
  await page.getByRole("button", { name: ja.send }).click();
  await expect(page.getByRole("button", { name: HARUHI_LABEL })).toBeVisible();
}

test("picking a clarify candidate reaches that work's results through the structured channel", async ({ page }) => {
  const sent: SentTurn[] = [];
  await askUntilClarify(page, sent);
  await page.getByRole("button", { name: HARUHI_LABEL }).click();
  await expect(page.getByText("西宮北高校")).toBeVisible();
  // No dead end, and no dishonest disconnect strip anywhere on the way.
  await expect(page.getByText(ja.errorStates.d4Message)).toHaveCount(0);
  expect(sent).toHaveLength(2);
  expect(sent[1]?.selected_candidate_ids).toEqual(["115908"]);
  expect(sent[1]?.clarification_id).toBe(4);
  expect(sent[1]?.turnId).toBeTruthy();
  expect(sent[1]?.turnId).not.toBe(sent[0]?.turnId);
});

test("a 409 on the pick shows the honest in-flight copy and retry resends the pick itself", async ({ page }) => {
  const sent: SentTurn[] = [];
  await askUntilClarify(page, sent, true);
  await page.getByRole("button", { name: HARUHI_LABEL }).click();
  await expect(page.getByText(ja.errorStates.d15Message)).toBeVisible();
  await expect(page.getByText(ja.errorStates.d4Message)).toHaveCount(0);
  // The card re-arms so picking again stays possible…
  await expect(page.getByRole("button", { name: HARUHI_LABEL })).toBeEnabled();
  // …and the strip's retry resends the failed pick, landing on results.
  await page.getByRole("button", { name: ja.errorStates.d15Retry }).click();
  await expect(page.getByText("西宮北高校")).toBeVisible();
  expect(sent).toHaveLength(3);
  expect(sent[2]?.selected_candidate_ids).toEqual(["115908"]);
  expect(sent[2]?.turnId).toBe(sent[1]?.turnId);
});
