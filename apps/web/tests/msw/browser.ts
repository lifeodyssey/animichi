import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

/**
 * Browser MSW swimlane: a Service Worker for real client-navigation tests
 * (vitest browser mode / Playwright component runs). Requires the generated
 * `public/mockServiceWorker.js`; `start()` is left to the test runner.
 *
 * NOTE: SSR is deliberately NOT covered by MSW. The Service Worker only
 * intercepts requests the browser makes; server renders bypass it entirely
 * and are validated against a real local Worker + backend at the G1 gate.
 */
export const worker = setupWorker(...handlers);
