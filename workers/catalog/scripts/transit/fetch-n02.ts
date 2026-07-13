import { execFile } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const DEFAULT_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-25/N02-25_GML.zip";
const outputDirectory = resolve("data/raw/n02");
const run = promisify(execFile);

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false);
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`N02 download failed: ${String(response.status)} ${response.statusText}`);
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entryPaths(directory, entry)));
  return nested.flat();
}

async function entryPaths(directory: string, entry: { isDirectory(): boolean; name: string }): Promise<string[]> {
  return entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)];
}

async function main(): Promise<void> {
  const url = argument("--url") ?? DEFAULT_URL;
  const zip = join(outputDirectory, basename(new URL(url).pathname) || "N02.zip");
  await mkdir(outputDirectory, { recursive: true });
  if (!(await exists(zip)) || process.argv.includes("--force")) await download(url, zip);
  await run("unzip", ["-o", zip, "-d", outputDirectory]);
  const found = (await walk(outputDirectory)).filter((path) => /(?:RailroadSection|Station).*\.geojson$/iu.test(path));
  console.log(`N02 GeoJSON found:\n${found.join("\n") || "none"}`);
}

await main();
