import ciWorkflow from "../../../.github/workflows/ci.yml?raw";
import deployWorkflow from "../../../.github/workflows/deploy.yml?raw";
import reusableDeploy from "../../../.github/workflows/_deploy-component.yml?raw";
import quotaWorkflow from "../../../.github/workflows/purge-anon-quota-counts.yml?raw";
import sessionWorkflow from "../../../.github/workflows/purge-anonymous-sessions.yml?raw";
import secretsDocs from "../../../docs/ops/secrets.md?raw";
import wranglerConfig from "../wrangler.toml?raw";
import { describe, expect, it } from "vitest";

const REQUIRED_DSN = 'required = ["AGENT_DATABASE_URL"]';
const CRONS = 'crons = ["37 18 * * *", "37 19 * * *"]';

describe("maintenance deployment configuration", () => {
  it("declares both original schedules for default, staging, and production", () => {
    expect(wranglerConfig.split(CRONS)).toHaveLength(4);
  });

  it("declares the same required DSN for default, staging, and production", () => {
    expect(wranglerConfig.split(REQUIRED_DSN)).toHaveLength(4);
  });

  it("wires AGENT_DATABASE_URL through reusable, CI, manual deploy, and docs", () => {
    expect(reusableDeploy).toContain("AGENT_DATABASE_URL: ${{ secrets.AGENT_DATABASE_URL }}");
    expect(ciWorkflow).toContain("component: maintenance");
    expect(ciWorkflow).toContain("AGENT_DATABASE_URL: ${{ secrets.AGENT_DATABASE_URL }}");
    expect(deployWorkflow).toContain("workingDirectory: workers/maintenance");
    expect(deployWorkflow).toContain("AGENT_DATABASE_URL: ${{ secrets.AGENT_DATABASE_URL }}");
    expect(secretsDocs).toContain("| `AGENT_DATABASE_URL` |");
  });

  it("keeps both deprecated workflows as manual-only fallbacks", () => {
    expect(quotaWorkflow).toContain("DEPRECATED");
    expect(quotaWorkflow).not.toMatch(/^\s+schedule:/m);
    expect(sessionWorkflow).toContain("DEPRECATED");
    expect(sessionWorkflow).not.toMatch(/^\s+schedule:/m);
  });
});
