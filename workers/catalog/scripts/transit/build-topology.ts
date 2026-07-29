/** Usage: pnpm exec tsx scripts/transit/fetch-n02.ts && pnpm exec tsx scripts/transit/build-topology.ts */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compareStrings } from "../../src/lib/transit/compare";
import { buildShinkansenSubgraph, buildTopologyAsset, parseEkidata, type EkidataCsvs } from "../../src/lib/transit/etl";

const dataDirectory = resolve("data");

async function files(directory: string): Promise<string[]> {
  return readdir(directory).catch(() => []);
}

async function csv(directory: string, prefix: string): Promise<string | null> {
  const name = (await files(directory)).filter((item) => item.startsWith(prefix) && item.endsWith(".csv")).sort(compareStrings)[0];
  return name ? readFile(join(directory, name), "utf8") : null;
}

async function ekidataInput(): Promise<EkidataCsvs | null> {
  const directory = join(dataDirectory, "raw/ekidata");
  const values = await Promise.all([csv(directory, "company"), csv(directory, "line"), csv(directory, "station"), csv(directory, "join")]);
  if (values.some((value) => value === null)) return null;
  return { company: values[0] ?? "", line: values[1] ?? "", station: values[2] ?? "", join: values[3] ?? "" };
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => entryPaths(directory, entry)));
  return nested.flat();
}

async function entryPaths(directory: string, entry: { isDirectory(): boolean; name: string }): Promise<string[]> {
  return entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)];
}

async function geojsonInputs(): Promise<{ sections: unknown; stations: unknown } | null> {
  const paths = await walk(join(dataDirectory, "raw/n02"));
  const section = paths.find((path) => /RailroadSection.*\.geojson$/iu.test(path));
  const station = paths.find((path) => /Station.*\.geojson$/iu.test(path) && !/RailroadSection/iu.test(path));
  if (!section || !station) return null;
  return { sections: JSON.parse(await readFile(section, "utf8")), stations: JSON.parse(await readFile(station, "utf8")) };
}

function printWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) console.warn(`warning: ${warning}`);
}

function warnMissing(rawEkidata: EkidataCsvs | null, rawN02: { sections: unknown; stations: unknown } | null): void {
  if (!rawEkidata) console.warn("warning: Download ekidata CSVs manually from https://www.ekidata.jp/ into data/raw/ekidata/");
  if (!rawN02) console.warn("warning: Run pnpm exec tsx scripts/transit/fetch-n02.ts to download N02 data");
}

function parseSources(rawEkidata: EkidataCsvs | null, rawN02: { sections: unknown; stations: unknown } | null) {
  return { ekidata: rawEkidata ? parseEkidata(rawEkidata) : null, n02: rawN02 ? buildShinkansenSubgraph(rawN02.sections, rawN02.stations) : null };
}

async function publish(asset: unknown): Promise<void> {
  await mkdir(join(dataDirectory, "dist"), { recursive: true });
  await writeFile(join(dataDirectory, "dist/topology.json"), `${JSON.stringify(asset, null, 2)}\n`);
}

async function main(): Promise<void> {
  const rawEkidata = await ekidataInput();
  const rawN02 = await geojsonInputs();
  warnMissing(rawEkidata, rawN02);
  const { ekidata, n02 } = parseSources(rawEkidata, rawN02);
  const result = buildTopologyAsset({ ekidata: ekidata?.graph, shinkansen: n02?.graph, generatedAt: new Date().toISOString() });
  await publish(result.asset);
  printWarnings([...(ekidata?.warnings ?? []), ...(n02?.warnings ?? []), ...result.warnings]);
  console.log(JSON.stringify(result.stats, null, 2));
}

await main();
