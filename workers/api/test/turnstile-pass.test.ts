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
