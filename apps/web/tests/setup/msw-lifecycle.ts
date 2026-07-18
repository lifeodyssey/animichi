import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "../msw/node";

// Node MSW swimlane lifecycle, shared by every unit test file.
beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
