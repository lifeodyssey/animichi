import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ChatResponseDataPart } from "../src/chat-data-parts.js";

const FIXTURES = ["search", "clarify", "error"] as const;
const STREAM_HEADER = { "x-vercel-ai-ui-message-stream": "v1" };
type Frame = Record<string, unknown>;

function fixturePath(name: string): URL {
  return new URL(`../../../apps/agent/tests/fixtures/chat_stream/${name}.sse`, import.meta.url);
}

function isFrame(value: unknown): value is Frame {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseValue(value: string): Frame | "[DONE]" {
  if (value === "[DONE]") return value;
  const parsed: unknown = JSON.parse(value);
  if (!isFrame(parsed)) throw new Error("SSE data must be a JSON object");
  return parsed;
}

function parseEvent(event: string): Frame | "[DONE]" {
  if (!event.startsWith("data: ")) throw new Error("Invalid SSE framing");
  return parseValue(event.slice(6));
}

function parseFixture(name: string): Array<Frame | "[DONE]"> {
  const raw = readFileSync(fixturePath(name), "utf8");
  return raw.trim().split("\n\n").map(parseEvent);
}

function frameTypes(frames: Array<Frame | "[DONE]">): string[] {
  return frames.map((frame) => frame === "[DONE]" ? frame : String(frame.type));
}

function dataResponses(frames: Array<Frame | "[DONE]">): Frame[] {
  return frames.filter((frame): frame is Frame => frame !== "[DONE]" && frame.type === "data-response");
}

function assertDataResponses(frames: Array<Frame | "[DONE]">): void {
  for (const frame of dataResponses(frames)) ChatResponseDataPart.parse(frame.data);
}

function assertTerminator(frames: Array<Frame | "[DONE]">): void {
  expect(frames.at(-1)).toBe("[DONE]");
  expect(frames.slice(0, -1)).not.toContain("[DONE]");
}

describe("recorded AI SDK UI message streams", () => {
  it.each(FIXTURES)("parses every %s data-response and snapshots its v1 sequence", (name) => {
    const frames = parseFixture(name);
    expect(STREAM_HEADER).toEqual({ "x-vercel-ai-ui-message-stream": "v1" });
    assertDataResponses(frames);
    assertTerminator(frames);
    expect(frameTypes(frames)).toMatchSnapshot();
  });

  it("accepts the intent-only first frame before the completed payload", () => {
    const parts = dataResponses(parseFixture("search"));
    expect(parts).toHaveLength(2);
    expect(ChatResponseDataPart.parse(parts[0]?.data)).toEqual({ intent: "plan_route" });
    expect(parts[0]?.id).toBe(parts[1]?.id);
  });

  it("pins the error part shape and error finish sequence", () => {
    const frames = parseFixture("error");
    const error = frames.find((frame) => frame !== "[DONE]" && frame.type === "error");
    expect(error).toEqual({ type: "error", errorText: "Something went wrong. Please try again." });
    expect(frameTypes(frames).slice(-4)).toEqual(["error", "finish-step", "finish", "[DONE]"]);
  });
});

describe("ChatResponseDataPart rejects invalid data", () => {
  it("rejects a missing intent", () => {
    expect(() => ChatResponseDataPart.parse({ message: "missing" })).toThrow();
  });

  it("rejects an unknown intent", () => {
    expect(() => ChatResponseDataPart.parse({ intent: "dance" })).toThrow();
  });

  it("rejects a malformed payload", () => {
    const malformed = { intent: "plan_route", data: { route: { ordered_points: "bad" } } };
    expect(() => ChatResponseDataPart.parse(malformed)).toThrow();
  });
});
