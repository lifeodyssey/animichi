import { describe, expect, it } from "vitest";
import { sanitizeReturnTarget } from "../../../src/lib/auth/returnTarget";

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
    "/chat?settings=byok",
    "/chat?settings=byok&session=abc",
    "/routes/123#map",
  ])("keeps the same-origin relative path %s", (path) => {
    expect(sanitizeReturnTarget(path)).toBe(path);
  });

  it("trims surrounding whitespace before honouring a valid path", () => {
    expect(sanitizeReturnTarget("  /chat?settings=byok ")).toBe("/chat?settings=byok");
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
    "chat?settings=byok",
    "/../evil",
    "/chat/../../etc",
  ])("rejects %j in favour of /", (vector) => {
    expect(sanitizeReturnTarget(vector)).toBe("/");
  });

  it("rejects a path smuggling a raw control character", () => {
    expect(sanitizeReturnTarget("/chat\u0000?settings=byok")).toBe("/");
  });

  it("rejects a path with embedded raw whitespace", () => {
    expect(sanitizeReturnTarget("/chat /evil")).toBe("/");
  });
});
