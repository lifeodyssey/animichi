import { isRecord } from "./http";

/** Reads the SAFE-1 pinned revision declared in the manifest at the token's sha. */
export type PinReader = (tokenSha: string) => Promise<string | null>;

const RELEASE_MANIFEST_PATH = ".github/release-manifests/production-pre-campaign.json";

/**
 * Default pin reader: fetches the committed release manifest at `tokenSha`
 * and returns its `source_revision`. Live-only — tests always inject a reader
 * and never invoke the network.
 */
export function releaseManifestPinReader(repository: string): PinReader {
  return (tokenSha: string): Promise<string | null> => readPinnedRevision(repository, tokenSha);
}

async function readPinnedRevision(repository: string, tokenSha: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${repository}/${tokenSha}/${RELEASE_MANIFEST_PATH}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return sourceRevisionOf(await response.json());
  } catch {
    return null;
  }
}

function sourceRevisionOf(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const revision = value.source_revision;
  return typeof revision === "string" && revision.length > 0 ? revision : null;
}
