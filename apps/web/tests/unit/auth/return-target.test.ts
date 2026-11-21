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

/**
 * #482 residual 1: a dot segment that only appears after percent-decoding slips
 * the raw `..` check — `/.%2e//evil.test` splits to `["", ".%2e", "", "evil.test"]`
 * and `new URL()` normalises the decoded `..` back to the rejected `//` shape.
 * The guard therefore checks the raw value AND its once-decoded form.
 */
describe("sanitizeReturnTarget — percent-encoded dot segments (#482)", () => {
  it.each([
    "/.%2e//evil.test",
    "/.%2E//evil.test",
    "/%2e%2e//evil.test",
    "/%2E%2E//evil.test",
    "/a/%2e%2e/b",
    "/.%2e/evil.test",
    "/%2e./evil.test",
    "/..%2f//evil.test",
  ])("falls back to / when %j hides a dot segment behind percent-encoding", (vector) => {
    expect(sanitizeReturnTarget(vector)).toBe("/");
  });

  it("rejects a value whose decode reveals a protocol-relative or backslash shape", () => {
    expect(sanitizeReturnTarget("/%2f%2fevil.test")).toBe("/");
    expect(sanitizeReturnTarget("/%5cevil.test")).toBe("/");
  });

  it("rejects a malformed percent sequence instead of throwing", () => {
    expect(sanitizeReturnTarget("/%")).toBe("/");
    expect(sanitizeReturnTarget("/%zz")).toBe("/");
  });

  it("keeps a percent-encoded path that decodes to something safe", () => {
    expect(sanitizeReturnTarget("/caf%C3%A9")).toBe("/caf%C3%A9");
    expect(sanitizeReturnTarget("/chat?q=hello%20world")).toBe("/chat?q=hello%20world");
  });
});

/**
 * #482 residual 3: `hasUnsafeChar` covered C0 + DEL only, while the module
 * header claimed "no raw whitespace or control characters". C1 controls
 * (U+0080-U+009F, including NEL) and the Unicode line/paragraph separators
 * U+2028/U+2029 must fall back, and the header must say what the check does.
 */
describe("sanitizeReturnTarget — C1 controls and Unicode separators (#482)", () => {
  it.each([
    "/settings\u0085#api-key",
    "/settings\u0080#api-key",
    "/settings\u009f#api-key",
    "/settings\u2028",
    "/settings\u2029",
  ])("falls back to / for the non-ASCII control/separator in %j", (vector) => {
    expect(sanitizeReturnTarget(vector)).toBe("/");
  });
});
