/**
 * Pixel comparison for the visual pipeline (S0-v2 C3): pixelmatch-style
 * perceptual delta + connected-component diff clusters.
 *
 * Deterministic: pure functions over RGBA buffers; no thresholds beyond the
 * caller-supplied ones.
 */

export interface DiffResult {
  /** RGBA heatmap: differing pixels red, everything else transparent. */
  diff: Uint8Array;
  /** Fraction of differing pixels in [0, 1]. */
  ratio: number;
}

export interface DiffCluster {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
}

const DEFAULT_THRESHOLD = 0.1;

function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) throw new Error("visual diff: truncated RGBA buffer");
  return value;
}

/** pixelmatch's weighted color delta; > threshold counts as a diff. */
function colorDelta(a: Uint8Array, b: Uint8Array, i: number): number {
  const rmean = (byteAt(a, i) + byteAt(b, i)) / 2;
  const dr = byteAt(a, i) - byteAt(b, i);
  const dg = byteAt(a, i + 1) - byteAt(b, i + 1);
  const db = byteAt(a, i + 2) - byteAt(b, i + 2);
  return Math.sqrt(((512 + rmean) * dr * dr) / 256 + 4 * dg * dg + ((767 - rmean) * db * db) / 256);
}

export function diffPixels(a: Uint8Array, b: Uint8Array, threshold = DEFAULT_THRESHOLD): DiffResult {
  if (a.length !== b.length) {
    throw new Error(`visual diff: length mismatch ${String(a.length)} vs ${String(b.length)}`);
  }
  const diff = new Uint8Array(a.length);
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (colorDelta(a, b, i) <= threshold) continue;
    diff[i] = 255;
    diff[i + 3] = 255;
    count += 1;
  }
  return { diff, ratio: count / (a.length / 4) };
}

function isDiffPixel(diff: Uint8Array, pos: number): boolean {
  return diff[pos * 4 + 3] !== 0;
}

function neighbors(width: number, height: number, pos: number): number[] {
  const x = pos % width;
  const y = (pos / width) | 0;
  const out: number[] = [];
  if (x > 0) out.push(pos - 1);
  if (x < width - 1) out.push(pos + 1);
  if (y > 0) out.push(pos - width);
  if (y < height - 1) out.push(pos + width);
  return out;
}

function popRequired(stack: number[]): number {
  const value = stack.pop();
  if (value === undefined) throw new Error("visual diff: empty flood-fill stack");
  return value;
}

function enqueueDiff(diff: Uint8Array, visited: Uint8Array, stack: number[], pos: number): void {
  if (visited[pos] || !isDiffPixel(diff, pos)) return;
  visited[pos] = 1;
  stack.push(pos);
}

function floodFill(diff: Uint8Array, width: number, height: number, visited: Uint8Array, start: number): DiffCluster {
  let minX = start % width;
  let maxX = minX;
  let minY = (start / width) | 0;
  let maxY = minY;
  let area = 0;
  const stack = [start];
  visited[start] = 1;
  while (stack.length > 0) {
    const pos = popRequired(stack);
    const x = pos % width;
    const y = (pos / width) | 0;
    area += 1;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (const next of neighbors(width, height, pos)) {
      enqueueDiff(diff, visited, stack, next);
    }
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area };
}

const byAreaDesc = (a: DiffCluster, b: DiffCluster): number => b.area - a.area;

/** 4-connected clusters of diff pixels, largest first; noise < minArea dropped. */
export function clusterBoxes(diff: Uint8Array, width: number, height: number, minArea = 4): DiffCluster[] {
  const visited = new Uint8Array(width * height);
  const clusters: DiffCluster[] = [];
  for (let pos = 0; pos < visited.length; pos++) {
    if (visited[pos] || !isDiffPixel(diff, pos)) continue;
    const cluster = floodFill(diff, width, height, visited, pos);
    if (cluster.area >= minArea) clusters.push(cluster);
  }
  return clusters.sort(byAreaDesc);
}
