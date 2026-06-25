import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

void initOpenNextCloudflareForDev();

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
// pnpm uses hoisted node_modules at the monorepo root (node-linker=hoisted in
// .npmrc). Turbopack must resolve next/package.json from the hoisted location,
// so turbopack.root must point to the monorepo root, not just the frontend dir.
const monorepoRoot = path.resolve(frontendRoot, "..");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
