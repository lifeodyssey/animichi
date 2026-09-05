import { describe, expect, it } from "vitest";
import {
  identityClassSchema,
  identityPolicySchema,
  type IdentityPolicy,
} from "../src/identity-contract.js";
import { DEFAULT_IDENTITY_POLICY } from "../src/identity-policy.js";

// AUTH-1 #945: pins every cell of the explicit public/anonymous/authenticated
// matrix. A divergent hardcoded quota/limit, or a matrix with the wrong shape,
// fails here.

describe("IdentityPolicy matrix", () => {
  it("pins the public class: no rate limit, no quota, no budget", () => {
    expect(DEFAULT_IDENTITY_POLICY.public).toEqual({
      rateLimit: null,
      dailyMessageQuota: null,
      dailyCostBudgetUsd: null,
    });
  });

  it("pins the anonymous class: 20/60 burst, 20 messages/day, $5/day budget", () => {
    expect(DEFAULT_IDENTITY_POLICY.anonymous).toEqual({
      rateLimit: { limit: 20, windowSeconds: 60 },
      dailyMessageQuota: 20,
      dailyCostBudgetUsd: 5.0,
    });
  });

  it("pins the authenticated class: 60/60 burst, no anonymous quota/budget", () => {
    expect(DEFAULT_IDENTITY_POLICY.authenticated).toEqual({
      rateLimit: { limit: 60, windowSeconds: 60 },
      dailyMessageQuota: null,
      dailyCostBudgetUsd: null,
    });
  });

  it("the anonymous and authenticated burst limits deliberately differ", () => {
    expect(DEFAULT_IDENTITY_POLICY.anonymous.rateLimit?.limit).not.toBe(
      DEFAULT_IDENTITY_POLICY.authenticated.rateLimit?.limit,
    );
  });

  it("round-trips the default through the zod schema", () => {
    const parsed = identityPolicySchema.parse(DEFAULT_IDENTITY_POLICY);
    expect(parsed).toEqual(DEFAULT_IDENTITY_POLICY);
  });

  it("recognises exactly the three identity classes", () => {
    expect(identityClassSchema.options).toEqual(["public", "anonymous", "authenticated"]);
    expect(identityClassSchema.safeParse("agent").success).toBe(false);
  });

  it("rejects a negative rate-limit window", () => {
    const bad = structuredClone(DEFAULT_IDENTITY_POLICY) as IdentityPolicy;
    bad.anonymous.rateLimit = { limit: 20, windowSeconds: -1 };
    expect(identityPolicySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a policy missing an identity class (the matrix is closed)", () => {
    const incomplete = {
      public: DEFAULT_IDENTITY_POLICY.public,
      anonymous: DEFAULT_IDENTITY_POLICY.anonymous,
    };
    expect(identityPolicySchema.safeParse(incomplete).success).toBe(false);
  });

  it("rejects an unexpected identity class (strict schema)", () => {
    const withAgent = { ...DEFAULT_IDENTITY_POLICY, agent: { rateLimit: null, dailyMessageQuota: null, dailyCostBudgetUsd: null } };
    expect(identityPolicySchema.safeParse(withAgent).success).toBe(false);
  });
});
