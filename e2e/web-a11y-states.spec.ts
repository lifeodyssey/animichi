import { describe, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { chatDictFor } from "../apps/web/src/features/chat/i18n";


test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
  locale: "ja-JP",
  colorScheme: "light",
  reducedMotion: "reduce",
  serviceWorkers: "block",
});

const ja = chatDictFor("ja");

const emptyAnimeOverview = {
  bangumi_id: "999",
  points_length: 0,
  circles: [],
  scenes: [],
  sample_itineraries: [],
};

async function openChat(page: Page): Promise<void> {
  await blockTurnstile(page);
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ status: 401, json: { error: "no session" } }),
  );
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  const healthy = page.waitForResponse((response) => response.url().includes("/healthz"));
  await page.goto("/chat");
  await healthy;
  await expect(page.getByRole("textbox")).toBeVisible();
}

async function navigateClient(page: Page, path: string, target: string): Promise<void> {
  const arrived = page.waitForURL((url) => url.pathname === path);
  await page.evaluate((next) => {
    const current = window.history.state ?? {};
    window.history.pushState({ ...current, __TSR_index: Number(current.__TSR_index ?? 0) + 1 }, "", next);
  }, path);
  await arrived;
  await expect(page.locator(target)).toBeVisible();
}

const blockTurnstile = (page: Page) =>
  page.route("https://challenges.cloudflare.com/**", (route) => route.abort());

describe("AC4 loading/streaming state", () => {
  test("an in-flight turn is announced via a live region and stays keyboard-operable", async ({ page }) => {
    // Hold the stream open so the busy state persists while we assert: a
    // fulfilled recording settles in milliseconds and the turn is over before
    // the first expectation runs.
    await page.route("**/v1/chat", () => {
      /* never respond: the turn stays in flight for the duration of the test */
    });
    await openChat(page);
    // Arm a turnstile token so an anonymous turn can be dispatched.
    await page.waitForFunction(() => typeof window.onAnimichiTurnstile === "function");
    await page.evaluate(() => { window.onAnimichiTurnstile?.("e2e-token"); });
    const input = page.getByRole("textbox");
    await input.fill("宇治");
    await page.keyboard.press("Enter");
    // Loading/streaming is surfaced through a polite live region. Spec G4 keeps
    // the field editable through the turn (the visitor may keep composing), so
    // the double-send guard lives on the send path instead: the key leaves the
    // tab order and Enter is swallowed. Focus is still free to move — the send
    // key being skipped is exactly why this walks backwards to prove it.
    await expect(page.locator('[aria-live="polite"]').first()).toBeAttached();
    await expect(input).toBeEnabled();
    await input.fill("もう一件");
    await expect(page.getByRole("button", { name: ja.send })).toBeDisabled();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("*:focus")).toHaveCount(1);
    await expect(page.locator("*:focus")).not.toHaveAttribute("class", /chat-input__field/);
  });
});

describe("AC4 empty states (no animation dependence)", () => {
  test("anime empty overview shows understandable prose", async ({ page }) => {
    await page.route("**/catalog/public/anime-overview/*", (route) =>
      route.fulfill({ json: emptyAnimeOverview }),
    );
    await openChat(page);
    await navigateClient(page, "/anime/999", ".anime-empty");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const body = await page.locator("main").innerText();
    expect(body.trim().length).toBeGreaterThan(0);
  });

  test("route-detail empty route shows understandable prose", async ({ page }) => {
    await page.route("**/v1/users/saved-routes", (route) =>
      route.fulfill({
        json: {
          saved_routes: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              title: "Blank draft",
              point_ids: [],
              status: "saved",
              saved_at: null,
              updated_at: "2026-07-18T00:00:00.000Z",
            },
          ],
        },
      }),
    );
    await page.route("**/catalog/itinerary", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        json: { ordered_points: [], point_count: 0,
          timed_itinerary: { stops: [], legs: [], total_minutes: 0, total_distance_m: 0 } },
      });
    });
    await openChat(page);
    await navigateClient(page, "/routes/22222222-2222-4222-8222-222222222222", ".route-panel");
    const body = await page.locator("main").innerText();
    expect(body.trim().length).toBeGreaterThan(0);
  });
});

describe("AC4 error states", () => {
  test("anime outage error is announced and reachable by keyboard", async ({ page }) => {
    await page.route("**/catalog/public/anime-overview/*", (route) =>
      route.fulfill({
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: { code: "INTERNAL_SERVER_ERROR", message: "catalog unavailable" } }),
      }),
    );
    await openChat(page);
    await navigateClient(page, "/anime/999", ".anime-error");
    await expect(page.getByRole("heading")).toBeVisible();
    await expect(page.getByRole("button").or(page.getByRole("link")).first()).toBeVisible();
  });
});

describe("AC4 Turnstile + Auth stay keyboard-reachable under reduced motion", () => {
  test("the anonymous chat dock hosts the challenge widget without blocking keyboard", async ({ page }) => {
    await openChat(page);
    await expect(page.locator(".turnstile-gate .cf-turnstile")).toHaveAttribute("data-appearance", "interaction-only");
    const input = page.getByRole("textbox");
    await input.focus();
    await expect(input).toBeFocused();
  });

  test("the auth flow is fully operable by keyboard (email -> submit)", async ({ page }) => {
    await openChat(page);
    // Open the login modal, then drive the whole sign-in form by keyboard:
    // the email field gets initial focus, then Tab reaches the submit button.
    const login = page.getByRole("button", { name: "ログイン" });
    await login.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /メール|email/i })).toBeFocused();
    await page.keyboard.type("fan@example.com");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("dialog").getByRole("button", { name: /送信|send|リンク/i })).toBeFocused();
  });
});
