/**
 * ChatInput location tests — REMOVED.
 *
 * The location button was removed from ChatInput during the design migration.
 * All tests in this file depended on that button (getByLabelText("location")).
 * File kept as a placeholder so git history remains clean.
 */
import { describe, it, expect } from "vitest";

describe("ChatInput location button (removed)", () => {
  it("location feature was removed during design migration", () => {
    expect(true).toBe(true);
  });
});
