/**
 * One JSON file per entry under `approved-breaking-changes/`, named
 * `<issue>-<method>-<path-slug>-<kind>.json`. Entry hygiene lives in
 * `test/approved-breaking-changes.test.ts`; a file the loader cannot read as an
 * entry fails the run, naming that file.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { REMOVAL_KINDS, type ApprovedBreakingChange } from "./openapi-approvals.js";

const RECORD_DIRECTORY = fileURLToPath(new URL("../approved-breaking-changes/", import.meta.url));

/** The shape a file has to parse to, written out for data no compiler has seen. */
const ENTRY = z.object({
  document: z.string().min(1),
  method: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(REMOVAL_KINDS),
  issue: z.string().min(1),
  approved: z.iso.date(),
});

/** The entry file names, sorted; dotfiles aside, a name that is not `.json` is a mistake. */
function entryFileNames(directory: string): readonly string[] {
  const names = readdirSync(directory).filter((name) => !name.startsWith("."));
  const stray = names.find((name) => !name.endsWith(".json"));
  if (stray !== undefined) throw new Error(`${join(directory, stray)}: the record holds one .json file per entry`);
  return names.sort();
}

/** The file's JSON, or a failure naming the file that could not be read as JSON. */
function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${file}: ${reason}`, { cause: error });
  }
}

function readEntry(directory: string, name: string): ApprovedBreakingChange {
  const file = join(directory, name);
  const parsed = ENTRY.safeParse(readJsonFile(file));
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`);
  return parsed.data;
}

/** The directory is injectable so a test can read its own fixture. */
export function readApprovedBreakingChanges(
  directory: string = RECORD_DIRECTORY,
): readonly ApprovedBreakingChange[] {
  return entryFileNames(directory).map((name) => readEntry(directory, name));
}
