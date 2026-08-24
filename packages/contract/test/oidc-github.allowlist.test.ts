import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { enforceGitHubOidcAllowlist } from "../src/oidc-github";
import { REPOSITORY, claims, productionPolicy, stagingPolicy } from "./oidc-github.helpers";

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
    const result = enforceGitHubOidcAllowlist(claims({ environment: undefined }), stagingPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a staging token for a non-main ref", () => {
    const result = enforceGitHubOidcAllowlist(claims({ ref: "refs/heads/feature" }), stagingPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects the MED-2 forbiddden OR form: ref==main OR environment==staging alone is not enough", () => {
    const refOnly = enforceGitHubOidcAllowlist(claims({ environment: undefined }), stagingPolicy());
    const envOnly = enforceGitHubOidcAllowlist(claims({ ref: "refs/heads/other" }), stagingPolicy());
    expect(refOnly).toEqual({ ok: false, reason: expect.any(String) });
    expect(envOnly).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a token from another repository", () => {
    const result = enforceGitHubOidcAllowlist(claims({ repository: "attacker/other" }), stagingPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a token minted for another audience", () => {
    const result = enforceGitHubOidcAllowlist(claims({ aud: "some-other-audience" }), stagingPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a token from another issuer", () => {
    const result = enforceGitHubOidcAllowlist(claims({ iss: "https://evil.example.test" }), stagingPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a token whose workflow_ref is not a trusted deploy workflow", () => {
    const result = enforceGitHubOidcAllowlist(
      claims({ workflow_ref: "lifeodyssey/animichi/.github/workflows/evil.yml@refs/heads/main" }),
      stagingPolicy(),
    );
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a token whose job_workflow_ref is not a trusted deploy workflow", () => {
    const result = enforceGitHubOidcAllowlist(
      claims({ job_workflow_ref: "lifeodyssey/animichi/.github/workflows/other.yml@refs/heads/main" }),
      stagingPolicy(),
    );
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects the retired CI deploy caller", () => {
    const retired = "lifeodyssey/animichi/.github/workflows/ci.yml@refs/heads/main";
    const result = enforceGitHubOidcAllowlist(claims({ workflow_ref: retired }), stagingPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a trusted workflow file from a non-main ref", () => {
    const feature = "lifeodyssey/animichi/.github/workflows/cd.yml@refs/heads/feature";
    const result = enforceGitHubOidcAllowlist(claims({ workflow_ref: feature }), stagingPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("production accepts the env sub anchor exactly (MED-2)", () => {
    const result = enforceGitHubOidcAllowlist(claims({ sub: `repo:${REPOSITORY}:environment:production` }), productionPolicy());
    expect(result).toEqual({ ok: true });
  });

  it("production rejects a staging sub anchor", () => {
    const result = enforceGitHubOidcAllowlist(claims(), productionPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("production rejects the plain repo sub anchor (not environment-scoped)", () => {
    const result = enforceGitHubOidcAllowlist(claims({ sub: `repo:${REPOSITORY}`, environment: undefined }), productionPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });
});
