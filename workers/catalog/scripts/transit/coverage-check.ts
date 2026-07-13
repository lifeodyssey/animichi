/** Full-catalog evaluation becomes meaningful once ekidata conventional rail is ingested; shinkansen-only coverage is a false negative. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseTopologyGraph } from "../../src/lib/transit";
import { stationCoverage, type CoverageSpot } from "../../src/lib/transit/etl";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function spot(value: unknown): value is CoverageSpot {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.lat === "number" && typeof item.lng === "number";
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main(): Promise<void> {
  const spotsPath = argument("--spots");
  if (!spotsPath) throw new Error("Usage: coverage-check.ts --spots <path.json> [--threshold 0.99]");
  const values = await json(resolve(spotsPath));
  if (!Array.isArray(values) || !values.every(spot)) throw new Error("Spots JSON must be an array of {id, lat, lng}");
  const asset = parseTopologyGraph(await json(resolve("data/dist/topology.json")));
  const result = stationCoverage(values, asset.stations);
  console.log(JSON.stringify(result));
  if (result.rate < Number(argument("--threshold") ?? "0.99")) process.exitCode = 1;
}

await main();
