#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const findingsPath = process.env.NEON_FINDINGS_PATH
  ?? fileURLToPath(new URL("./FINDINGS.md", import.meta.url));
const seedPath = fileURLToPath(
  new URL("../../apps/agent/agent/tests/fixtures/seed.sql", import.meta.url),
);
const requireFromCatalog = createRequire(
  new URL("../../workers/catalog/package.json", import.meta.url),
);
const baseTables = [
  "bangumi",
  "points",
  "cluster_version",
  "route_snapshots",
  "aliases",
  "series_edges",
  "leg_cache",
  "raw_anitabi",
  "raw_bangumi",
  "media_assets",
  "ingest_jobs",
];

let failures = 0;

function safe(value) {
  return String(value)
    .replaceAll("\n", " ")
    .replaceAll("|", "/")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "<redacted-dsn>")
    .slice(0, 300);
}

async function record(item, passed, evidence) {
  const status = passed ? "PASS" : "FAIL";
  const cleanEvidence = safe(evidence);
  console.log(`${status} ${item}\n  evidence: ${cleanEvidence}`);
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/u, "+00:00");
  const mode = process.env.NEON_PHASE0_MODE ?? "serverless";
  await appendFile(
    findingsPath,
    `| ${stamp} | ${mode} | ${item} | ${status} | ${cleanEvidence} |\n`,
    "utf8",
  );
  failures += passed ? 0 : 1;
}

async function check(item, probe) {
  try {
    await record(item, true, await probe());
  } catch (error) {
    await record(item, false, error instanceof Error ? error.message : error);
  }
}

function configuration() {
  const port = Number.parseInt(process.env.NEON_LOCAL_PORT ?? "", 10);
  const database = process.env.NEON_LOCAL_DATABASE ?? "neondb";
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("NEON_LOCAL_PORT must be a mapped Neon Local port");
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(database)) {
    throw new Error("NEON_LOCAL_DATABASE has an invalid format");
  }
  return { database, port };
}

async function seedAndTruncate(sql) {
  const relationRows = await sql.query(
    "SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relname = ANY($1::text[])",
    [[...baseTables, "route_anime"]],
  );
  const existing = new Set(relationRows.map((row) => row.relname));
  const missing = baseTables.filter((table) => !existing.has(table));
  if (missing.length > 0) {
    throw new Error(`closed-set baseline tables missing: ${missing.join(",")}`);
  }
  const closedSet = [...baseTables, ...(existing.has("route_anime") ? ["route_anime"] : [])];
  const identifiers = closedSet.map((table) => `"${table}"`).join(", ");
  await sql.query(`TRUNCATE ${identifiers} RESTART IDENTITY`, []);
  const emptyRows = await sql`SELECT (SELECT count(*)::int FROM bangumi) AS bangumi,
    (SELECT count(*)::int FROM points) AS points`;
  const seed = await readFile(seedPath, "utf8");
  const statements = seed.match(/INSERT INTO[\s\S]*?ON CONFLICT \(id\) DO NOTHING;/gu) ?? [];
  if (statements.length !== 2) {
    throw new Error(`expected 2 idempotent seed statements, found ${statements.length}`);
  }
  for (const statement of statements) {
    await sql.query(statement, []);
  }
  const seededRows = await sql`SELECT (SELECT count(*)::int FROM bangumi) AS bangumi,
    (SELECT count(*)::int FROM points) AS points`;
  const empty = emptyRows[0].bangumi === 0 && emptyRows[0].points === 0;
  const seeded = seededRows[0].bangumi === 18 && seededRows[0].points === 43;
  if (!empty || !seeded) {
    throw new Error(`unexpected cycle counts empty=${JSON.stringify(emptyRows[0])} seeded=${JSON.stringify(seededRows[0])}`);
  }
  return `NO CASCADE; tables=${closedSet.length}; reseeded bangumi=18 points=43`;
}

async function main() {
  let driver;
  try {
    driver = requireFromCatalog("@neondatabase/serverless");
  } catch (error) {
    const reason = error instanceof Error ? error.message : error;
    for (const item of ["Raw neon() HTTP query", "Serverless transaction batch", "Serverless seed and TRUNCATE cycle"]) {
      await record(item, false, `workers/catalog dependencies unavailable: ${reason}`);
    }
    return;
  }

  const { database, port } = configuration();
  const endpoint = `http://127.0.0.1:${port}/sql`;
  const connectionString = `postgres://neon:npg@127.0.0.1:${port}/${database}?sslmode=require`;
  const snapshot = {
    fetchEndpoint: driver.neonConfig.fetchEndpoint,
    poolQueryViaFetch: driver.neonConfig.poolQueryViaFetch,
    useSecureWebSocket: driver.neonConfig.useSecureWebSocket,
  };

  try {
    driver.neonConfig.fetchEndpoint = endpoint;
    driver.neonConfig.useSecureWebSocket = false;
    driver.neonConfig.poolQueryViaFetch = true;
    const sql = driver.neon(connectionString);
    await check("Raw neon() HTTP query", async () => {
      const rows = await sql`SELECT 42::int AS answer`;
      if (rows[0]?.answer !== 42) throw new Error("raw query returned the wrong value");
      return `fetchEndpoint host=127.0.0.1:${port}; answer=42`;
    });
    await check("Serverless transaction batch", async () => {
      const results = await sql.transaction([
        sql`SELECT txid_current()::text AS txid`,
        sql`SELECT txid_current()::text AS txid`,
      ]);
      const first = results[0][0]?.txid;
      const second = results[1][0]?.txid;
      if (!first || first !== second) throw new Error("batch queries did not share a transaction id");
      return `two-query batch shared txid=${first}`;
    });
    await check("Serverless seed and TRUNCATE cycle", () => seedAndTruncate(sql));
    // The pg.Pool wire-protocol control (self-signed TLS against the local
    // proxy) was removed after the Phase-0 verdict REJECTED the wire path —
    // its measured outcome is preserved in FINDINGS.md; only the PROVEN
    // serverless HTTP arm remains probed here.
  } finally {
    driver.neonConfig.fetchEndpoint = snapshot.fetchEndpoint;
    driver.neonConfig.useSecureWebSocket = snapshot.useSecureWebSocket;
    driver.neonConfig.poolQueryViaFetch = snapshot.poolQueryViaFetch;
  }
}

try {
  await main();
} catch (error) {
  await record("Serverless probe setup", false, error instanceof Error ? error.message : error);
}

process.exitCode = failures > 0 ? 1 : 0;
