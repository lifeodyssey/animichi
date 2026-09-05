import { expect, type Page } from "@playwright/test";

/**
 * Open a route in the client, so the suite's `page.route` stubs apply.
 *
 * `/anime/$bangumiId` and `/routes/$routeId` run their loaders on the server
 * during a document load, where a browser-level stub cannot reach them: with
 * the catalog unreachable, `curl /anime/999` answers **500**, so a `page.goto`
 * never reaches the empty state these scans are about. `/routes/$routeId` also
 * has no in-app link to click — the product has no route list yet — so the
 * History API is the entry point.
 *
 * TanStack Router patches `window.history.pushState` and navigates on it
 * (`@tanstack/history` `createBrowserHistory`); a `null` state lets the router
 * mint its own bookkeeping, which is why nothing here touches its internals.
 * Journeys that DO have a link click it instead (`web-chat-settings-return`).
 */
export async function enterRoute(page: Page, path: string, target: string): Promise<void> {
  const arrived = page.waitForURL((url) => url.pathname === path);
  await page.evaluate((next) => { window.history.pushState(null, "", next); }, path);
  await arrived;
  await expect(page.locator(target)).toBeVisible();
}
