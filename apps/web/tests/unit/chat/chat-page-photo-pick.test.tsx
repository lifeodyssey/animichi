/**
 * @vitest-environment jsdom
 */
import type { ChatTurnRequest } from "@animichi/contract";
import { fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { chatStreamHandler } from "../../msw/chat-handlers";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { server } from "../../msw/node";
import { makeJpegBlobWithExif } from "../shiori/_jpeg-fixtures";
import { renderChatPage } from "./_chat-page";

/**
 * A photo candidate picked inside the PRODUCTION provider stack (web-H1,
 * #1336). ChatPage wraps the whole page — dock included — in
 * `ClarifyPickProvider`, so a bare `PhotoSearchUpload` render proves nothing
 * about what a visitor's click actually does. A photo offer is sessionless:
 * its pick belongs to the offer (`/v1/photo-search/confirm`, AC11), never to
 * the session's pending clarification, which for a photo turn does not exist —
 * that pick would reach `/v1/chat` as `selected_candidate_ids` with a null
 * `clarification_id` and come back `invalid_selection`, the offer unconfirmed.
 */

// jsdom reports en-US, so page copy renders from the en dict.
const en = chatDictFor("en");
const PHOTO_URL = `${TEST_ORIGIN}/v1/photo-search`;
const CONFIRM_URL = `${TEST_ORIGIN}/v1/photo-search/confirm`;
const KEION = "けいおん!";
/** Mounting the whole page and running an upload round trip outgrows vitest's
 * 5s default on a loaded machine. A ceiling, not a latency assertion. */
const PAGE_MOUNT_BUDGET_MS = 30_000;

/** A photo offer whose vision pass missed: the C2 clarify branch (AC5). */
const PHOTO_CLARIFY_OFFER = {
  success: true,
  status: "ok",
  intent: "clarify",
  offer_id: "offer-7",
  data: { reason: "photo_unrecognized", candidates: [{ id: "9912", title: KEION }] },
};

/** The pick's wire shape, taken from the contract's `ChatTurnRequest`, so this
 * test cannot drift from what a structured pick actually looks like. */
type TurnBody = Pick<ChatTurnRequest, "selected_candidate_ids" | "clarification_id">;

interface OfferProbe {
  readonly confirmed: unknown[];
  readonly turns: Promise<TurnBody>[];
}

function makeOfferProbe(): OfferProbe {
  return { confirmed: [], turns: [] };
}

function offerHandlers(probe: OfferProbe) {
  return [
    http.post(PHOTO_URL, () => HttpResponse.json(PHOTO_CLARIFY_OFFER)),
    http.post(CONFIRM_URL, async ({ request }) => {
      probe.confirmed.push(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
    chatStreamHandler("search", {
      spy: (request) => { probe.turns.push(request.clone().json() as Promise<TurnBody>); },
    }),
  ];
}

/** Upload a photo into the live chat dock and wait for the offer's candidate.
 * The wait is bounded well above the default second: this mounts the whole
 * page, and the candidate appears only after the upload's round trip — as is
 * each case's own budget below. Both are wait ceilings, never an assertion
 * about how long anything took. */
async function pickPhotoCandidate(probe: OfferProbe) {
  server.use(...offerHandlers(probe));
  renderChatPage();
  const file = new File([makeJpegBlobWithExif()], "unknown_landscape.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText(en.photo.upload), { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: KEION }, { timeout: 10_000 }));
}

describe("photo offer pick in the production provider stack (web-H1, #1336)", () => {
  it("confirms the server-issued offer with the chosen candidate (AC11)", async () => {
    const probe = makeOfferProbe();
    await pickPhotoCandidate(probe);
    await vi.waitFor(() => { expect(probe.confirmed).toHaveLength(1); }, { timeout: 10_000 });
    expect(probe.confirmed[0]).toEqual({ offer_id: "offer-7", candidate_id: "9912" });
  }, PAGE_MOUNT_BUDGET_MS);

  it("continues the conversation as free text, not as a session clarification pick", async () => {
    const probe = makeOfferProbe();
    await pickPhotoCandidate(probe);
    await vi.waitFor(() => { expect(probe.turns).toHaveLength(1); }, { timeout: 10_000 });
    const turn = await probe.turns[0];
    expect(turn?.selected_candidate_ids).toBeUndefined();
    expect(turn?.clarification_id).toBeUndefined();
  }, PAGE_MOUNT_BUDGET_MS);
});
