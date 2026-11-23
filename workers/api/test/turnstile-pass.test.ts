import test from "node:test";
import assert from "node:assert/strict";
import { TURNSTILE_WINDOW_MS } from "@animichi/contract/constants";
import { issueTurnstilePass, verifyTurnstilePass } from "../src/identity/turnstile-pass.ts";

const ID = "anon_0123456789abcdef0123456789abcdef";
const OTHER = "anon_fedcba9876543210fedcba9876543210";
const SECRET = "fixed-test-hmac-key-0000000000000000";
const NOW = Date.UTC(2026, 7, 24, 1, 0, 0);

function request(cookie: string): Request {
  return new Request("https://animichi.test/v1/chat", { headers: { Cookie: cookie.split(";")[0] ?? "" } });
}

function replacePass(cookie: string, transform: (value: string) => string): string {
  return cookie.replace(/turnstile_pass=([^;]+)/, (_, value: string) => `turnstile_pass=${transform(value)}`);
}

void test("a signed pass is valid for its aid inside the window", async () => {
  const cookie = await issueTurnstilePass(ID, SECRET, NOW);
  assert.equal(await verifyTurnstilePass(request(cookie), ID, SECRET, NOW + 1), true);
});

void test("a pass cannot be replayed with another aid", async () => {
  const cookie = await issueTurnstilePass(ID, SECRET, NOW);
  assert.equal(await verifyTurnstilePass(request(cookie), OTHER, SECRET, NOW + 1), false);
});

void test("a tampered pass fails closed", async () => {
  const cookie = await issueTurnstilePass(ID, SECRET, NOW);
  const tampered = cookie.replace(/turnstile_pass=([^;]+)/, "turnstile_pass=$1x");
  assert.equal(await verifyTurnstilePass(request(tampered), ID, SECRET, NOW + 1), false);
});

void test("an expired pass fails closed", async () => {
  const cookie = await issueTurnstilePass(ID, SECRET, NOW);
  assert.equal(await verifyTurnstilePass(request(cookie), ID, SECRET, NOW + TURNSTILE_WINDOW_MS), false);
});

void test("a pass with an extra segment fails closed", async () => {
  const cookie = await issueTurnstilePass(ID, SECRET, NOW);
  const malformed = replacePass(cookie, (value) => `${value}.ignored`);
  assert.equal(await verifyTurnstilePass(request(malformed), ID, SECRET, NOW + 1), false);
});

void test("a pass with a malformed signature fails closed", async () => {
  const cookie = await issueTurnstilePass(ID, SECRET, NOW);
  const malformed = replacePass(cookie, (value) => `${value.slice(0, value.indexOf(".") + 1)}ABC`);
  assert.equal(await verifyTurnstilePass(request(malformed), ID, SECRET, NOW + 1), false);
});

// The pass's format check admits only 64 lower-case hex characters, so none of
// these signatures reaches the comparison; the `aid` cookie's, which has no
// such check, is pinned at the gateway in `gateway-entry-aid-signature.test.ts`.
const RESHAPED_SIGNATURES: readonly (readonly [shape: string, reshape: (signature: string) => string])[] = [
  ["cut short by one character", (signature) => signature.slice(0, -1)],
  ["emptied", () => ""],
  ["lengthened by one character", (signature) => `${signature}0`],
  ["upper-cased", (signature) => signature.toUpperCase()],
  ["of the right length with one non-ASCII character", (signature) => `${signature.slice(0, -1)}é`],
];

for (const [shape, reshape] of RESHAPED_SIGNATURES) {
  void test(`a pass whose signature is ${shape} fails closed without throwing`, async () => {
    const cookie = await issueTurnstilePass(ID, SECRET, NOW);
    const reshaped = replacePass(cookie, (value) => {
      const signatureStart = value.indexOf(".") + 1;
      return `${value.slice(0, signatureStart)}${reshape(value.slice(signatureStart))}`;
    });
    assert.equal(await verifyTurnstilePass(request(reshaped), ID, SECRET, NOW + 1), false);
  });
}
