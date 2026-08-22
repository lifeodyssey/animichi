import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #1073 — doorbell file-scan isolation (unit): the doorbell binds only
// Builds-token-shaped secrets, never a database DSN; the migrator never binds
// a Builds token; committed trigger maps never name the doorbell itself.

const HERE = `${dirname(fileURLToPath(import.meta.url))}/`;

function read(relative: string): string {
  return readFileSync(`${HERE}${relative}`, "utf8");
}

describe("doorbell bindings are Builds-token-shaped only", () => {
  it("never binds the migrator DSN or any DATABASE_URL", () => {
    const toml = read("../wrangler.toml");
    expect(toml).not.toContain("MIGRATOR_DATABASE_URL");
    expect(toml).not.toContain("DATABASE_URL");
    expect(toml).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(toml).toContain("BUILDS_API_TOKEN");
  });

  it("create-app Env never mentions the migrator DSN", () => {
    const source = read("../src/create-app.ts");
    expect(source).not.toContain("MIGRATOR_DATABASE_URL");
    expect(source).toContain("BUILDS_API_TOKEN");
  });

  it("migrator wrangler.toml never binds a Builds token", () => {
    const toml = read("../../migrator/wrangler.toml");
    expect(toml).not.toContain("BUILDS_API_TOKEN");
    expect(toml).not.toContain("CLOUDFLARE_API_TOKEN");
  });
});

describe("committed trigger maps", () => {
  it("never name the doorbell itself", () => {
    const toml = read("../wrangler.toml");
    const staging = /STAGING_TRIGGER_MAP = "([^"]*)"/.exec(toml)?.[1] ?? "";
    const production = /PRODUCTION_TRIGGER_MAP = "([^"]*)"/.exec(toml)?.[1] ?? "";
    expect(staging).not.toContain("doorbell");
    expect(production).not.toContain("doorbell");
  });
});
