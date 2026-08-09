import ciWorkflow from "../../../.github/workflows/ci.yml?raw";
import deployWorkflow from "../../../.github/workflows/deploy.yml?raw";
import reusableDeploy from "../../../.github/workflows/reusable-deploy-component.yml?raw";
import quotaWorkflow from "../../../.github/workflows/purge-anon-quota-counts.yml?raw";
import sessionWorkflow from "../../../.github/workflows/purge-anonymous-sessions.yml?raw";
import secretsDocs from "../../../docs/ops/secrets.md?raw";
import wranglerConfig from "../wrangler.toml?raw";
import { describe, expect, it } from "vitest";

export const READS = [
  ".github/workflows/reusable-deploy-component.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/deploy.yml",
  ".github/workflows/purge-anon-quota-counts.yml",
  ".github/workflows/purge-anonymous-sessions.yml",
  "docs/ops/secrets.md",
  "workers/jobs/wrangler.toml",
] as const;

const REQUIRED_DSN = 'required = ["AGENT_DATABASE_URL"]';
const CRONS = 'crons = ["37 18 * * *", "37 19 * * *"]';
const STORE_ID = "66c9bb0faef644b4a0671bb7d90d98bd";

describe("maintenance deployment configuration", () => {
  it("declares both original schedules for default, staging, and production", () => {
    expect(wranglerConfig.split(CRONS)).toHaveLength(4);
  });

  it("keeps `secrets.required` for production only (#912 PR2)", () => {
    // Production still uploads AGENT_DATABASE_URL from the GH environment
    // secret; staging reads the Secrets Store binding instead, and wrangler
    // rejects a name in BOTH `secrets.required` and a secrets_store binding.
    expect(wranglerConfig.split(REQUIRED_DSN)).toHaveLength(2);
    expect(wranglerConfig).not.toContain("[secrets]");
  });

  it("declares the staging Secrets Store binding (#912 PR2)", () => {
    expect(wranglerConfig).toContain("[[env.staging.secrets_store_secrets]]");
    expect(wranglerConfig).toContain('binding = "AGENT_DATABASE_URL"');
    expect(wranglerConfig).toContain(`store_id = "${STORE_ID}"`);
    expect(wranglerConfig).toContain('secret_name = "AGENT_DATABASE_URL"');
    // Production must NOT bind the staging store secret: the store holds
    // staging-role DSNs only, so a production binding would point prod at the
    // staging database (#912 cutover is a separate phase).
    expect(wranglerConfig).not.toContain("[[env.production.secrets_store_secrets]]");
  });

  it("wires AGENT_DATABASE_URL through reusable, CI, manual deploy, and docs", () => {
    // Production keeps the GH-secret upload chain until the #912 cutover;
    // staging reads the DSN from the Secrets Store binding instead.
    expect(reusableDeploy).toContain("AGENT_DATABASE_URL: ${{ secrets.AGENT_DATABASE_URL }}");
    expect(ciWorkflow).toContain("component: maintenance");
    expect(ciWorkflow).toContain("AGENT_DATABASE_URL: ${{ secrets.AGENT_DATABASE_URL }}");
    // #486 thin caller: deploy.yml passes inputs/secrets; env and Atlas live in reusable-deploy-component.yml.
    expect(deployWorkflow).toContain("working_directory: workers/jobs");
    expect(deployWorkflow).toContain("AGENT_DATABASE_URL: ${{ secrets.AGENT_DATABASE_URL }}");
    expect(secretsDocs).toContain("| `AGENT_DATABASE_URL` |");
  });

  it("drops the staging maintenance GH-secret pass-through from CI", () => {
    const stagingJob =
      ciWorkflow.match(/deploy-maintenance-staging:[\s\S]*?concurrency: deploy-maintenance-staging/)?.[0] ??
      "";
    expect(stagingJob).not.toContain("AGENT_DATABASE_URL: ${{ secrets.AGENT_DATABASE_URL }}");
    expect(stagingJob).not.toContain("worker_secrets");
    expect(stagingJob).toContain("component: maintenance");
  });

  it.each([
    ["purge-anon-quota-counts.yml", quotaWorkflow],
    ["purge-anonymous-sessions.yml", sessionWorkflow],
  ])("keeps %s as a manual-only deprecated fallback", (_name, workflow) => {
    expect(workflow).toContain("DEPRECATED");
    expect(workflow).not.toMatch(/^\s+schedule:/m);
    expect(workflow).toMatch(/^\s+workflow_dispatch:/m);
  });
});
