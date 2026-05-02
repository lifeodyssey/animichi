import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

const runtimeUrl = process.env.NEXT_PUBLIC_RUNTIME_URL || "http://localhost:8080";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: frontendRoot,
  },
  rewrites: async () => [
    { source: "/v1/:path*", destination: `${runtimeUrl}/v1/:path*` },
    { source: "/img/:path*", destination: "https://image.anitabi.cn/:path*" },
  ],
};

export default nextConfig;
