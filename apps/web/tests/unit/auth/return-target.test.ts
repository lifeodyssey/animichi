import { describe, expect, it } from "vitest";
import { sanitizeReturnTarget } from "../../../src/lib/auth/return-target";

/**
 * T14 open-redirect guard (issue #284 Task 8, T8-AC5/AC6): only same-origin
 * relative paths beginning with a single `/` survive; everything else — an
 * absolute URL, a protocol-relative `//host`, a scheme-ish string, any
 * backslash variant — falls back to `/`.
 */
describe("sanitizeReturnTarget — honoured targets", () => {
  it.each([
    "/",
    "/chat",
    "/settings#api-key",
    "/routes/123#map",
  ])("keeps the same-origin relative path %s", (path) => {
    expect(sanitizeReturnTarget(path)).toBe(path);
  });

  it("trims surrounding whitespace before honouring a valid path", () => {
    expect(sanitizeReturnTarget("  /settings#api-key ")).toBe("/settings#api-key");
  });
});

describe("sanitizeReturnTarget — null/empty fallback (T8-AC5)", () => {
  it.each([undefined, null, 42, { to: "/chat" }, ["/chat"]])(
    "falls back to / for the non-string %o",
    (value) => {
      expect(sanitizeReturnTarget(value)).toBe("/");
    },
  );

  it.each(["", "   ", "\t", "\n"])("falls back to / for empty/whitespace %j", (value) => {
    expect(sanitizeReturnTarget(value)).toBe("/");
  });
});

describe("sanitizeReturnTarget — T14 attack vectors (T8-AC6)", () => {
  it.each([
    "https://evil.test/",
    "http://evil.test",
    "//evil.test",
    "http:/evil.test",
    "/\\evil.test",
    "\\/evil.test",
    "\\\\evil.test",
    "/chat\\..\\evil",
    "javascript:alert(1)",
    "data:text/html,x",
    "settings#api-key",
    "/../evil",
    "/chat/../../etc",
  ])("rejects %j in favour of /", (vector) => {
    expect(sanitizeReturnTarget(vector)).toBe("/");
  });

  it("rejects a path smuggling a raw control character", () => {
    expect(sanitizeReturnTarget("/settings\u0000#api-key")).toBe("/");
  });

  it("rejects a path with embedded raw whitespace", () => {
    expect(sanitizeReturnTarget("/chat /evil")).toBe("/");
  });
});
