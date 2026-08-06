import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL as NodeURL } from "node:url";
import {
  buildGazetteer,
  CANONICAL_COMMAND,
  SOURCE_LOCK_PATH,
  validateGazetteer,
  verifySourceHashes,
  type CityNames,
  type CliOptions,
  type SourceHashes,
} from "./gazetteer-lib";
import { renderAudit, renderSql } from "./gazetteer-render";

export {
  buildGazetteer,
  CANONICAL_COMMAND,
  PREFECTURES,
  validateGazetteer,
  verifySourceHashes,
  type Gazetteer,
  type Kind,
  type LocationRow,
  type AliasRow,
  type Prefecture,
} from "./gazetteer-lib";
export { renderAudit, renderSql } from "./gazetteer-render";

function options(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    index = applyFlag(argv, index, result);
  }
  return result;
}

function applyFlag(argv: string[], index: number, result: Record<string, string | boolean>): number {
  const key = argv[index]?.replace(/^--/u, "");
  const value = argv[index + 1];
  if (key === "update-sources") { result[key] = true; return index; }
  if (!key || !value) throw new Error("Usage: --stations <path> --cities <path> --out-sql <path> --out-audit <path> [--update-sources]");
  result[key] = value;
  return index + 1;
}

function requiredOptions(args: Record<string, string | boolean>): CliOptions {
  const { stations, cities, "out-sql": outSql, "out-audit": outAudit } = args;
  if (typeof stations !== "string" || typeof cities !== "string" || typeof outSql !== "string" || typeof outAudit !== "string") throw new Error("missing required gazetteer generator option");
  return { stations, cities, outSql, outAudit, updateSources: args["update-sources"] === true };
}

async function main(): Promise<void> {
  const args = requiredOptions(options(process.argv.slice(2)));
  const namesPath = fileURLToPath(new NodeURL("../../../apps/agent/src/animichi/agents/data/city_names_jp.json", import.meta.url));
  const [stationText, cityText, namesText, lockText] = await Promise.all([readFile(resolve(args.stations), "utf8"), readFile(resolve(args.cities), "utf8"), readFile(namesPath, "utf8"), readFile(SOURCE_LOCK_PATH, "utf8")]);
  const hashes = { stations: sha256(stationText), cities: sha256(cityText) };
  verifySourceHashes(hashes, JSON.parse(lockText) as SourceHashes, args.updateSources);
  const gazetteer = buildGazetteer({ stations: JSON.parse(stationText), cities: cityText, cityNames: JSON.parse(namesText) as CityNames });
  validateGazetteer(gazetteer);
  await Promise.all([publish(args.outSql, renderSql(gazetteer, { stationSha: hashes.stations, citiesSha: hashes.cities, command: CANONICAL_COMMAND })), publish(args.outAudit, renderAudit(gazetteer))]);
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

async function publish(path: string, contents: string): Promise<void> { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(resolve(path), contents); }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
