import { expect, test as base, type Page } from "@playwright/test";
import { solveTurnstileEntry, stubTurnstileEntry } from "../helpers/turnstile";

/**
 * The visitor the hermetic chat specs drive: no session, a stubbed Turnstile,
 * no backend. The specs used to copy these steps into a local `openChat` each;
 * each now calls the step it needs at the point its copy ran, so the spec's own
 * routes, clock and media emulation keep their place around the entry.
 *
 * The fixture only builds the object. It navigates nowhere on its own, because
 * a fixture runs before the test body and would take the entry ahead of the
 * routes a spec registers first.
 */
export class AnonymousVisitor {
  readonly #page: Page;

  constructor(page: Page) {
    this.#page = page;
  }

  /** The auth SDK's session probe answers 401, so the app treats the page as
   *  signed out rather than as a probe that failed. */
  async stubSignedOutSession(): Promise<void> {
    await this.#page.route("**/api/auth/get-session", (route) =>
      route.fulfill({ status: 401, json: { error: "no session" } }),
    );
  }

  /** What the chat entry crosses: the Turnstile SDK and its server
   *  verification, and a healthy backend probe. */
  async stubEntryTransport(): Promise<void> {
    await stubTurnstileEntry(this.#page);
    await this.#page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  }

  /** Load `/chat`, pass the Turnstile gate, and wait for the hydrated client:
   *  the health probe fires only once React has attached, so the composer's
   *  handlers are live when this returns. Whatever a spec asserts next — the
   *  composer, a dialog, a route — stays in that spec. */
  async enterChat(): Promise<void> {
    await this.stubEntryTransport();
    const hydrated = this.#page.waitForResponse((response) => response.url().includes("/healthz"));
    await this.#page.goto("/chat");
    await solveTurnstileEntry(this.#page);
    await hydrated;
  }
}

export const test = base.extend<{ anonymousVisitor: AnonymousVisitor }>({
  anonymousVisitor: async ({ page }, use) => {
    await use(new AnonymousVisitor(page));
  },
});

export { expect };
