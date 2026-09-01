import { expect, test, type Page } from "@playwright/test";
import { solveTurnstileEntry, stubTurnstileEntry } from "./helpers/turnstile";

// E2E_WEB_BASE_URL targets the apps/web app (dev :3000 / CI wrangler :8799).
test.use({
  baseURL: process.env.E2E_WEB_BASE_URL ?? "http://localhost:3000",
});

// Issue #426: a hydration ReferenceError wiped the SSR DOM on every route, so asserting markup on
// the 404 page alone is not enough — collect uncaught browser errors and require none.
async function collectPageErrors(page: Page, path: string, ready: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(path);
  await expect(page.locator(ready)).toBeVisible();
  return errors;
}

test("undefined route hydrates without uncaught errors", async ({ page }) => {
  expect(await collectPageErrors(page, "/this-route-does-not-exist", "#not-found-title")).toEqual([]);
});

test("home route hydrates without uncaught errors", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubTurnstileEntry(page);
  // Keep the request pending for the journey, but let the handler SETTLE
  // before fixture teardown: Playwright 1.62 waits for active route handlers
  // when the fixture closes, so a never-resolving handler hangs the close.
  // heldOpenStarted closes the race where releaseHeldOpen() would run before
  // the handler was ever invoked (and captured the route resolve).
  let releaseHeldOpen!: () => void;
  const heldOpenStarted = new Promise<void>((resolve) => {
    releaseHeldOpen = (): void => {
      resolve();
      releaseHeldRoute();
    };
  });
  let releaseHeldRoute!: () => void;
  await page.route("**/held-open", () => {
    return new Promise<void>((resolve) => {
      releaseHeldRoute = resolve;
      releaseHeldOpen();
    });
  });
  await heldOpenStarted;
  await page.addInitScript(() => {
    window.addEventListener("load", () => { void fetch("/held-open"); });
  });
  const errors = collectPageErrors(page, "/", ".chat-page");
  await solveTurnstileEntry(page);
  expect(await errors).toEqual([]);
  releaseHeldOpen();
  await page.close();
});

test("undefined route renders a branded 404", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");

  expect(response?.status()).toBe(404);

  // Scope to the 404 <main> landmark: the root document also renders an
  // aria-hidden splash screen containing its own "ANIMICHI" wordmark before
  // this page's content in DOM order (see src/routes/__root.tsx), and
  // getByText() matches case-insensitively, so an unscoped
  // getByText("Animichi").first() is ambiguous between the two nodes. Which
  // one .first() resolved to — and whether it was visible — depended on how
  // far the splash's CSS dismissal animation had progressed when the
  // assertion polled, making the check a startup-timing race rather than a
  // check of the 404 page itself.
  const notFoundRegion = page.getByRole("main", { name: "404" });
  await expect(notFoundRegion.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(notFoundRegion.getByText("Animichi")).toBeVisible();

  const homeLink = notFoundRegion.getByRole("link", { name: "Return home" });
  await expect(homeLink).toBeVisible();
  await expect(homeLink).toHaveAttribute("href", "/");
});
