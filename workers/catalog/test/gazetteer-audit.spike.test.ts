import { readFile } from "node:fs/promises";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { collapseGeocodeHits, type GeocodeHit } from "../src/lib/geocode";
import { normalizeAlias } from "../src/lib/alias";

const AUDIT_PATH = fileURLToPath(new NodeURL("../data/gazetteer-audit.csv", import.meta.url));
interface AuditRow { id: string; name: string; lat: number; lng: number }

function csvFields(line: string): string[] {
  const tokens = line.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/gu) ?? [];
  return tokens.map((token) => token.replace(/^,/u, "")).map((token) => (
    token.startsWith('"') ? token.slice(1, -1).replaceAll('""', '"') : token
  ));
}

function auditRow(line: string): AuditRow {
  const fields = csvFields(line);
  return { id: fields[0] ?? "", name: fields[2] ?? "", lat: Number(fields[3]), lng: Number(fields[4]) };
}

async function auditRows(): Promise<AuditRow[]> {
  const text = await readFile(AUDIT_PATH, "utf8");
  return text.split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("id,") && !line.startsWith("SUMMARY,"))
    .map(auditRow);
}

function clusterCount(rows: AuditRow[]): number {
  const hits: GeocodeHit[] = rows.map((row) => ({
    id: row.id, name: row.name, kind: "city", latitude: row.lat, longitude: row.lng,
    source: "manual", pref: null, priority: 0, exact: true,
  }));
  return collapseGeocodeHits(hits, hits.length).length;
}

function highestFrequency(rows: AuditRow[]): AuditRow[][] {
  const groups = new Map<string, AuditRow[]>();
  for (const row of rows) groups.set(normalizeAlias(row.name), [...(groups.get(normalizeAlias(row.name)) ?? []), row]);
  return [...groups.values()].sort((left, right) => right.length - left.length).slice(0, 100);
}

describe("gazetteer corpus audit", () => {
  it("pins the high-frequency place-name cluster distribution", async () => {
    const rows = await auditRows();
    const sampledAliases = highestFrequency(rows);
    const counts = sampledAliases.map(clusterCount).sort((left, right) => left - right);
    const p95 = counts[Math.floor((counts.length - 1) * 0.95)];
    const singletonFraction = counts.filter((count) => count === 1).length / counts.length;

    expect(rows.length).toBeGreaterThanOrEqual(11_000);
    expect(sampledAliases).toHaveLength(100);
    expect(counts.every((count) => count >= 1)).toBe(true);
    expect(p95).toBeLessThanOrEqual(8);
    expect(singletonFraction).toBeGreaterThanOrEqual(0.008);
  });
});
