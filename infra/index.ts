import * as pulumi from "@pulumi/pulumi";

// Wave 0 spike (2026-06-23) validated:
//   - Pulumi auto-provisions Cloudflare resources (R2 bucket + DNS + Workers
//     routes) with only a scoped CLOUDFLARE_API_TOKEN, using local state.
//   - `wrangler deploy` of a no-route worker does NOT clobber Pulumi-managed
//     routes → "routes belong to Pulumi, worker code belongs to wrangler".
//
// Wave 2+ will declare the real infra here, parameterized per stack
// (prod / staging) — R2 (media + Pulumi state), Hyperdrive (catalog→pg),
// Workers routes (web `/*`, edge `/v1/*`+`/img/*`), DNS, secrets.
// See docs/superpowers/specs/2026-06-23-platform-monorepo-cf-deploy-design.md

export const wave0 = pulumi.output("spike-validated");
