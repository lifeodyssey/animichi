import type { SelectedExecutor, SelectedPreflight } from "../src/selected-migration";
import { TARGET } from "./sealed-migrations";

/** The preview a database already standing at the selected identity would produce. */
export const COMPATIBLE_PREVIEW: SelectedPreflight = {
  compatible: true,
  prisma: { targetHash: TARGET, markerHash: TARGET, migrations: [], usedLiveMarker: true },
};

/** An executor that records every DSN the route handed it — so a test can assert the route
 * refused BEFORE reaching the database, not merely that it answered a refusal. */
export function recordingExecutor(preview: SelectedPreflight = COMPATIBLE_PREVIEW) {
  const calls: string[] = [];
  const selected: SelectedExecutor = {
    preflight: (dsn) => { calls.push(dsn); return Promise.resolve(preview); },
    migrate: (dsn) => { calls.push(dsn); return Promise.resolve({ kind: "success", exitCode: 0 }); },
  };
  return { selected, calls };
}
