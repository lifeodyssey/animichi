/**
 * The Neon Auth origin's resolution rule, as a specification (#1690 review).
 *
 * Two sites need this value and they have to agree: `playwright.config.ts`
 * points the app under test at it, and `web-neon-login.spec.ts` posts the live
 * sign-in to it. They used to carry a rule each, and the two rules parted
 * company exactly when the primary variable was declared but EMPTY — the
 * config skipped it and used the `VITE_` value while the spec took the empty
 * string, so the app under test targeted one origin and the proof failed
 * against another, for a reason that had nothing to do with login.
 *
 * These cases pin the one rule both sites now read through.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { NEON_AUTH_ORIGIN_ENV_VARS, declaredNeonAuthOrigin } from "./neon-auth-origin.ts";

void test("the two names are declared here, in precedence order", () => {
  assert.deepEqual([...NEON_AUTH_ORIGIN_ENV_VARS], [
    "NEON_AUTH_BASE_URL",
    "VITE_NEON_AUTH_BASE_URL",
  ]);
});

void test("the primary name wins when both are declared", () => {
  assert.equal(
    declaredNeonAuthOrigin({
      NEON_AUTH_BASE_URL: "https://primary.example",
      VITE_NEON_AUTH_BASE_URL: "https://vite.example",
    }),
    "https://primary.example",
  );
});

void test("an empty primary falls through to the VITE_ name", () => {
  assert.equal(
    declaredNeonAuthOrigin({
      NEON_AUTH_BASE_URL: "",
      VITE_NEON_AUTH_BASE_URL: "https://vite.example",
    }),
    "https://vite.example",
  );
});

void test("a whitespace-only primary falls through to the VITE_ name", () => {
  assert.equal(
    declaredNeonAuthOrigin({
      NEON_AUTH_BASE_URL: "   ",
      VITE_NEON_AUTH_BASE_URL: "https://vite.example",
    }),
    "https://vite.example",
  );
});

void test("the declared value is trimmed", () => {
  assert.equal(
    declaredNeonAuthOrigin({ NEON_AUTH_BASE_URL: " https://primary.example " }),
    "https://primary.example",
  );
});

void test("an empty value with nothing to fall back to is not a declaration", () => {
  assert.equal(declaredNeonAuthOrigin({ NEON_AUTH_BASE_URL: "" }), undefined);
});

void test("neither name declared resolves to undefined", () => {
  assert.equal(declaredNeonAuthOrigin({}), undefined);
});
