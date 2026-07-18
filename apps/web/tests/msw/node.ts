import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/**
 * Node MSW swimlane: intercepts `fetch` in component and loader unit tests
 * (jsdom + the node pool). This is NOT the SSR path — the emitted Worker
 * runtime is verified by the live integration suite, not MSW.
 */
export const server = setupServer(...handlers);
