/**
 * The Neon Auth JWKS address and issuer derivation, pinned by its literal outputs.
 *
 * The API Worker verifies a Neon Auth JWT against `NEON_AUTH_JWKS_URL` and expects the token's
 * `iss` and `aud` to be that address's origin; infra derives the address from the branch's Better
 * Auth base URL (`infra/src/neon-auth.ts`). A derived value that moves by one character fails every
 * login, so each output below is a literal string, never computed by the code under test.
 *
 * test-type: unit (pure functions; no network, no clock).
 */
import { describe, expect, it } from "vitest";
import * as infra from "../../../infra/src/neon-auth";

type Derivation = (input: string) => string;

const JWKS_COPIES: [string, Derivation][] = [
  ["infra", infra.jwksUrlFromAuthBaseUrl],
];

const ISSUER_COPIES: [string, Derivation][] = [
  ["infra", infra.issuerFromJwksUrl],
];

/** Base URL in, JWKS address out: appended as written, never normalised. */
const JWKS_ADDRESSES: [string, string, string][] = [
  [
    "the staging shape, <origin>/neondb/auth",
    "https://auth.example.test/neondb/auth",
    "https://auth.example.test/neondb/auth/.well-known/jwks.json",
  ],
  [
    "one trailing slash",
    "https://auth.example.test/neondb/auth/",
    "https://auth.example.test/neondb/auth/.well-known/jwks.json",
  ],
  [
    "several trailing slashes",
    "https://auth.example.test/neondb/auth///",
    "https://auth.example.test/neondb/auth/.well-known/jwks.json",
  ],
  [
    "an uppercase host and an explicit default port, kept as written",
    "https://AUTH.Example.TEST:443/neondb/auth",
    "https://AUTH.Example.TEST:443/neondb/auth/.well-known/jwks.json",
  ],
  ["a bare origin", "https://auth.example.test", "https://auth.example.test/.well-known/jwks.json"],
  ["malformed input, returned rather than refused", "not a url", "not a url/.well-known/jwks.json"],
  ["an empty string", "", "/.well-known/jwks.json"],
];

/** JWKS address in, issuer out: the address's origin, as `URL` normalises it. */
const ISSUERS: [string, string, string][] = [
  ["the staging shape", "https://auth.example.test/neondb/auth/.well-known/jwks.json", "https://auth.example.test"],
  [
    "an uppercase host and an explicit default port",
    "https://AUTH.Example.TEST:443/neondb/auth/.well-known/jwks.json",
    "https://auth.example.test",
  ],
  [
    "a non-default port, which the origin keeps",
    "https://auth.example.test:8443/neondb/auth/.well-known/jwks.json",
    "https://auth.example.test:8443",
  ],
  ["an address without the well-known suffix", "https://auth.example.test/neondb/auth", "https://auth.example.test"],
];

/** Addresses `URL` refuses: here the issuer throws where the address derivation returned a value. */
const UNPARSEABLE: [string, string][] = [
  ["malformed input", "not a url"],
  ["the address an empty base URL derives", "/.well-known/jwks.json"],
];

describe.each(JWKS_COPIES)("%s jwksUrlFromAuthBaseUrl", (_copy, derive) => {
  it.each(JWKS_ADDRESSES)("%s", (_input, baseUrl, address) => {
    expect(derive(baseUrl)).toBe(address);
  });
});

describe.each(ISSUER_COPIES)("%s issuerFromJwksUrl", (_copy, derive) => {
  it.each(ISSUERS)("%s", (_input, address, issuer) => {
    expect(derive(address)).toBe(issuer);
  });

  it.each(UNPARSEABLE)("throws a TypeError on %s", (_input, address) => {
    expect(() => derive(address)).toThrow(TypeError);
  });
});
