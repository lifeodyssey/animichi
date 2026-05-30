import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    // Root must include the animal-island-ui package path (file: symlink outside project)
    // so turbopack can resolve asset url() references in the package CSS.
    root: path.resolve(frontendRoot, "../../../../../.."),
  },
};

export default nextConfig;
