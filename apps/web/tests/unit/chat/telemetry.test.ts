import { describe, expect, it } from "vitest";
import {
  formatElapsed,
  lastChatTiming,
  recordChatTiming,
} from "../../../src/features/chat/telemetry";

describe("recordChatTiming", () => {
  it("keeps the latest first-token latency retrievable", () => {
    recordChatTiming({ kind: "first_token", ms: 1234 });
    expect(lastChatTiming("first_token")).toBe(1234);
  });

  it("tracks turn duration independently of first-token latency", () => {
    recordChatTiming({ kind: "first_token", ms: 800 });
    recordChatTiming({ kind: "turn", ms: 9200 });
    expect(lastChatTiming("first_token")).toBe(800);
    expect(lastChatTiming("turn")).toBe(9200);
  });

  it("emits a performance mark named after the timing kind", () => {
    performance.clearMarks("chat:first_token");
    recordChatTiming({ kind: "first_token", ms: 500 });
    expect(performance.getEntriesByName("chat:first_token").length).toBeGreaterThan(0);
  });
});

describe("formatElapsed", () => {
  it.each([
    [9200, "9.2s"],
    [800, "0.8s"],
    [12000, "12.0s"],
  ] as const)("renders %ims as %s", (ms, label) => {
    expect(formatElapsed(ms)).toBe(label);
  });
});
