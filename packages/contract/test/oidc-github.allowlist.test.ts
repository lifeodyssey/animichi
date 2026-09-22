import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { enforceGitHubOidcAllowlist } from "../src/oidc-github";
import {
  REPOSITORY,
  TRUSTED_CD_WORKFLOW,
  claims,
  productionPolicy,
  rejectionReason,
  stagingPolicy,
} from "./oidc-github.helpers";
import type { GitHubOidcClaims } from "../src/oidc-github";

// #1051 — MED-2 per-environment-anchored allowlist enforcement (migrator
// trigger authentication): staging needs ref==main AND env==staging.

beforeAll(() => {
  vi.useFakeTimers({ now: new Date("2026-02-01T00:00:00.000Z"), shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("enforceGitHubOidcAllowlist (MED-2 per-environment anchoring)", () => {
  it("accepts a fully-anchored staging token", () => {
    expect(enforceGitHubOidcAllowlist(claims(), stagingPolicy())).toEqual({ ok: true });
  });

  it("rejects a main-branch token that omits the staging environment claim", () => {
    rejectionReason(enforceGitHubOidcAllowlist(claims({ environment: undefined }), stagingPolicy()));
  });

  it("rejects a staging token for a non-main ref", () => {
    rejectionReason(enforceGitHubOidcAllowlist(claims({ ref: "refs/heads/feature" }), stagingPolicy()));
  });

  it("rejects the MED-2 forbiddden OR form: ref==main OR environment==staging alone is not enough", () => {
    rejectionReason(enforceGitHubOidcAllowlist(claims({ environment: undefined }), stagingPolicy()));
    rejectionReason(enforceGitHubOidcAllowlist(claims({ ref: "refs/heads/other" }), stagingPolicy()));
  });
});

describe("enforceGitHubOidcAllowlist (the production sub anchor)", () => {
  it("production accepts the env sub anchor exactly (MED-2)", () => {
    const sub = `repo:${REPOSITORY}:environment:production`;
    expect(enforceGitHubOidcAllowlist(claims({ sub }), productionPolicy())).toEqual({ ok: true });
  });

  it("production rejects a staging sub anchor", () => {
    rejectionReason(enforceGitHubOidcAllowlist(claims(), productionPolicy()));
  });

  it("production rejects the plain repo sub anchor (not environment-scoped)", () => {
    const unscoped = claims({ sub: `repo:${REPOSITORY}`, environment: undefined });
    rejectionReason(enforceGitHubOidcAllowlist(unscoped, productionPolicy()));
  });

  it("production rejects a token with no sub when only the sub anchor could pass", () => {
    const policy = { ...productionPolicy(), refAllow: [] };
    rejectionReason(enforceGitHubOidcAllowlist(claims({ sub: undefined }), policy));
  });

  it("production rejects an empty sub rather than matching an empty allow entry", () => {
    const policy = { ...productionPolicy(), refAllow: [], subAllow: [""] };
    rejectionReason(enforceGitHubOidcAllowlist(claims({ sub: "" }), policy));
  });
});

describe("enforceGitHubOidcAllowlist (issuer, repository and workflow anchors)", () => {
  it("rejects a token from another repository", () => {
    rejectionReason(enforceGitHubOidcAllowlist(claims({ repository: "attacker/other" }), stagingPolicy()));
  });

  it("rejects a token minted for another audience", () => {
    rejectionReason(enforceGitHubOidcAllowlist(claims({ aud: "some-other-audience" }), stagingPolicy()));
  });

  it("rejects a token from another issuer", () => {
    rejectionReason(enforceGitHubOidcAllowlist(claims({ iss: "https://evil.example.test" }), stagingPolicy()));
  });

  it("rejects a token whose workflow_ref is not a trusted deploy workflow", () => {
    const untrusted = claims({ workflow_ref: "lifeodyssey/animichi/.github/workflows/evil.yml@refs/heads/main" });
    rejectionReason(enforceGitHubOidcAllowlist(untrusted, stagingPolicy()));
  });

  it("rejects a token whose job_workflow_ref is not a trusted deploy workflow", () => {
    const untrusted = claims({ job_workflow_ref: "lifeodyssey/animichi/.github/workflows/other.yml@refs/heads/main" });
    rejectionReason(enforceGitHubOidcAllowlist(untrusted, stagingPolicy()));
  });

  it("rejects the retired CI deploy caller", () => {
    const retired = "lifeodyssey/animichi/.github/workflows/ci.yml@refs/heads/main";
    rejectionReason(enforceGitHubOidcAllowlist(claims({ workflow_ref: retired }), stagingPolicy()));
  });

  it("rejects a trusted workflow file from a non-main ref", () => {
    const feature = "lifeodyssey/animichi/.github/workflows/cd.yml@refs/heads/feature";
    rejectionReason(enforceGitHubOidcAllowlist(claims({ workflow_ref: feature }), stagingPolicy()));
  });
});

// One case per allowlist branch: this is an auth boundary, so a branch with
// no test is a hole nobody would notice closing by accident.

describe("enforceGitHubOidcAllowlist (workflow refs fail closed)", () => {
  it("rejects a token that names no workflow at all (fail closed)", () => {
    const naked = claims({ workflow_ref: undefined, job_workflow_ref: undefined });
    rejectionReason(enforceGitHubOidcAllowlist(naked, stagingPolicy()));
  });

  it("accepts a token carrying only a trusted job_workflow_ref", () => {
    const jobOnly = claims({ workflow_ref: undefined, job_workflow_ref: TRUSTED_CD_WORKFLOW });
    expect(enforceGitHubOidcAllowlist(jobOnly, stagingPolicy())).toEqual({ ok: true });
  });

  // `claims` is the *unverified* payload jose hands back, so a claim can be any
  // JSON value. A non-string workflow ref is a forged shape, not an absent one:
  // it must not let the token through on the strength of its other ref.
  it("rejects a non-string workflow_ref even when the other ref is trusted", () => {
    const forged: GitHubOidcClaims = {
      ...claims({ job_workflow_ref: TRUSTED_CD_WORKFLOW }),
      workflow_ref: 1 as unknown as string,
    };
    rejectionReason(enforceGitHubOidcAllowlist(forged, stagingPolicy()));
  });
});

describe("enforceGitHubOidcAllowlist (audience claims)", () => {
  it("accepts an audience array that contains the policy audience", () => {
    const policy = stagingPolicy();
    const multi: GitHubOidcClaims = { ...claims(), aud: ["other-service", policy.audience] };
    expect(enforceGitHubOidcAllowlist(multi, policy)).toEqual({ ok: true });
  });

  it("rejects an audience array that does not contain the policy audience", () => {
    const multi: GitHubOidcClaims = { ...claims(), aud: ["other-service", "third-service"] };
    rejectionReason(enforceGitHubOidcAllowlist(multi, stagingPolicy()));
  });

  it("rejects a token carrying no audience claim", () => {
    const none: GitHubOidcClaims = { ...claims(), aud: undefined };
    rejectionReason(enforceGitHubOidcAllowlist(none, stagingPolicy()));
  });
});

describe("enforceGitHubOidcAllowlist (ref-only anchors and missing claims)", () => {
  it("accepts a ref-only anchor when the policy shape names no environment", () => {
    const policy = { ...stagingPolicy(), refAllow: [{ ref: "refs/heads/main" }] };
    const noEnvironment = claims({ environment: undefined });
    expect(enforceGitHubOidcAllowlist(noEnvironment, policy)).toEqual({ ok: true });
  });

  it("names the missing claim when issuer or repository is absent", () => {
    const noIssuer: GitHubOidcClaims = { ...claims(), iss: undefined };
    expect(rejectionReason(enforceGitHubOidcAllowlist(noIssuer, stagingPolicy()))).toContain("(missing)");
    const noRepository = claims({ repository: undefined });
    expect(rejectionReason(enforceGitHubOidcAllowlist(noRepository, stagingPolicy()))).toContain("(missing)");
  });
});
