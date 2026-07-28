/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/chat-actions";
import { PhotoSearchUpload } from "../../../src/features/chat/components/PhotoSearchUpload";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { MAX_PHOTO_BYTES } from "../../../src/features/chat/photo-search";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { server } from "../../msw/node";
import { makeJpegWithExif } from "../shiori/_jpegFixtures";

const dict = chatDictFor("ja");
const URL = `${TEST_ORIGIN}/v1/photo-search`;
const CONFIRM_URL = `${TEST_ORIGIN}/v1/photo-search/confirm`;

afterEach(cleanup);

const SEARCH_ENVELOPE = {
  success: true,
  status: "ok",
  intent: "search_bangumi",
  data: {
    results: {
      kind: "bangumi",
      bangumi_id: "160209",
      title: "君の名は。",
      row_count: 1,
      rows: [{ id: "p1", name: "須賀神社", bangumi_id: "160209", episode: -1, screenshot_url: "", latitude: 35.685, longitude: 139.72, title: "君の名は。" }],
    },
  },
};

const CLARIFY_ENVELOPE = {
  success: true,
  status: "ok",
  intent: "clarify",
  data: { reason: "photo_unrecognized", candidates: [{ id: "9912", title: "けいおん!" }] },
};

function quotaBody(guidance: string) {
  return { error: { code: "photo_search_quota_exhausted", message: "used up", details: { guidance } } };
}

function renderUpload(send = vi.fn()) {
  render(
    <ChatActionsProvider actions={{ send, regenerate: vi.fn() }}>
      <PhotoSearchUpload dict={dict} baseUrl={TEST_ORIGIN} context={{ locale: "ja" }} />
    </ChatActionsProvider>,
  );
  return send;
}

function pickFile(type: string, name = "photo.jpg", bytes: Uint8Array<ArrayBuffer> = makeJpegWithExif() as Uint8Array<ArrayBuffer>) {
  const input = screen.getByLabelText(dict.photo.upload);
  const file = new File([bytes], name, { type });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("PhotoSearchUpload happy path (AC4 client)", () => {
  it("renders the recognized title's search card through the shared path", async () => {
    server.use(http.post(URL, () => HttpResponse.json(SEARCH_ENVELOPE)));
    renderUpload();
    pickFile("image/jpeg");
    expect(await screen.findByText("須賀神社")).toBeTruthy();
    expect(document.querySelector('[data-intent="search_bangumi"]')).toBeTruthy();
  });
});

describe("PhotoSearchUpload degradation (AC5)", () => {
  it("renders the clarify branch with the manual-entry chip for an unknown photo", async () => {
    server.use(http.post(URL, () => HttpResponse.json(CLARIFY_ENVELOPE)));
    renderUpload();
    pickFile("image/jpeg", "unknown_landscape.jpg");
    expect(await screen.findByText(dict.clarify.question)).toBeTruthy();
    expect(screen.getByRole("button", { name: dict.clarify.manualChip })).toBeTruthy();
    expect(screen.getByRole("button", { name: "けいおん!" })).toBeTruthy();
  });

  it("selecting a candidate sends it and fires the confirm ping (AC11)", async () => {
    const confirmed: unknown[] = [];
    server.use(
      http.post(URL, () => HttpResponse.json(CLARIFY_ENVELOPE)),
      http.post(CONFIRM_URL, async ({ request }) => {
        confirmed.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const send = renderUpload();
    pickFile("image/jpeg");
    fireEvent.click(await screen.findByRole("button", { name: "けいおん!" }));
    expect(send).toHaveBeenCalledWith("けいおん!");
    await vi.waitFor(() => { expect(confirmed).toHaveLength(1); });
    expect(confirmed[0]).toEqual({ query_type: "anime_screenshot", gps_available: false, layer_hit: "none", candidates_shown: 1 });
  });
});

describe("PhotoSearchUpload errors (AC7)", () => {
  it("rejects an unsupported format with clear copy and no request", async () => {
    const seen = vi.fn();
    server.use(http.post(URL, () => { seen(); return HttpResponse.json(SEARCH_ENVELOPE); }));
    renderUpload();
    pickFile("image/gif", "photo.gif");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(dict.photo.unsupported)).toBeTruthy();
    expect(seen).not.toHaveBeenCalled();
  });

  it("rejects a file over the 8MB cap before reading it — no request (P1-2)", async () => {
    const seen = vi.fn();
    server.use(http.post(URL, () => { seen(); return HttpResponse.json(SEARCH_ENVELOPE); }));
    renderUpload();
    pickFile("image/jpeg", "big.jpg", new Uint8Array(MAX_PHOTO_BYTES + 1));
    expect(await screen.findByText(dict.photo.tooLarge)).toBeTruthy();
    expect(seen).not.toHaveBeenCalled();
  });

  it("a failed upload shows on-brand copy with retry — no stuck spinner", async () => {
    server.use(http.post(URL, () => HttpResponse.error()));
    renderUpload();
    pickFile("image/jpeg");
    expect(await screen.findByText(dict.photo.failed)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: dict.photo.retry }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an invalid envelope falls back to the failure copy, not a crash", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ intent: "hack" })));
    renderUpload();
    pickFile("image/jpeg");
    expect(await screen.findByText(dict.photo.failed)).toBeTruthy();
  });
});

describe("PhotoSearchUpload quota guidance (AC9/AC10 copy branches)", () => {
  it("guides a no-BYOK user toward configuring a vision key", async () => {
    server.use(http.post(URL, () => HttpResponse.json(quotaBody("configure_vision_key"), { status: 429 })));
    renderUpload();
    pickFile("image/jpeg");
    expect(await screen.findByText(dict.photo.quotaNoByok)).toBeTruthy();
  });

  it("guides a BYOK-without-vision user toward switching endpoint", async () => {
    server.use(http.post(URL, () => HttpResponse.json(quotaBody("switch_vision_endpoint"), { status: 429 })));
    renderUpload();
    pickFile("image/jpeg");
    expect(await screen.findByText(dict.photo.quotaByokNoVision)).toBeTruthy();
  });
});
