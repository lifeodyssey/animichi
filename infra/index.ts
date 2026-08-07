// Composition root for Cloudflare Pulumi IaC.
// Resource modules register side effects on import; this file re-exports the
// stable public surface topology tests and stack consumers rely on.
// Layout: see src/README.md

import "./src/buckets.ts"
import "./src/web-routes.ts"
import "./src/hardening.ts"
import "./src/staging.ts"

export { catalogDatabaseUrl } from "./src/config.ts"
export { validateLegacyRedirectZones } from "./src/web-routes.ts"
export { validateIpEntry, buildIpClause } from "./src/staging.ts"
export {
  wave0,
  catalogBucketName,
  tilesBucketName,
} from "./src/outputs.ts"
