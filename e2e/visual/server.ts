/**
 * Tiny zero-dependency static server for the visual pipeline (S0-v2 C3).
 * Serves the frozen canonical dir at "/" and the app's self-hosted font
 * files at "/fonts" (the canonical HTML references them via the app's own
 * @font-face CSS, verbatim). No caching, so every run re-reads the bytes.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

export interface VisualServer {
  url: (pathname: string) => string;
  close: () => Promise<void>;
}

export interface Mount {
  prefix: string;
  root: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json",
};

function resolveWithin(root: string, pathname: string): string {
  const filePath = path.resolve(root, "." + pathname);
  if (!filePath.startsWith(path.resolve(root) + path.sep)) throw new Error(`visual server: escape attempt: ${pathname}`);
  return filePath;
}

function serveFile(res: http.ServerResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(filePath).pipe(res);
}

function notFound(res: http.ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

function matchesMount(pathname: string, mount: Mount): boolean {
  if (mount.prefix === "/") return true;
  return pathname === mount.prefix || pathname.startsWith(`${mount.prefix}/`);
}

function requestFile(rawUrl: string | undefined, mounts: Mount[]): string {
  const pathname = new URL(rawUrl ?? "/", "http://127.0.0.1").pathname;
  const mount = mounts.find((candidate) => matchesMount(pathname, candidate));
  const offset = mount?.prefix.length ?? 0;
  const relative = mount?.prefix === "/" ? pathname : pathname.slice(offset);
  return resolveWithin(mount?.root ?? ".", relative === "" ? "/" : relative);
}

function serveRequest(mounts: Mount[], req: http.IncomingMessage, res: http.ServerResponse): void {
  const filePath = requestFile(req.url, mounts);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    notFound(res);
    return;
  }
  serveFile(res, filePath);
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function startVisualServer(mounts: Mount[]): Promise<VisualServer> {
  // Most-specific prefix first, so "/" never shadows "/fonts".
  const sortedMounts = [...mounts].sort((a, b) => b.prefix.length - a.prefix.length);
  const server = http.createServer((req, res) => {
    serveRequest(sortedMounts, req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: (pathname: string) => `http://127.0.0.1:${String(port)}${pathname}`,
    close: () => closeServer(server),
  };
}
