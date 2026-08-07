// Composition root for Cloudflare Pulumi IaC.
// Resource modules register side effects on import; this file re-exports the
// stable public surface topology tests and stack consumers rely on.
// Layout: see src/README.md

import "./src/buckets"
import "./src/web-routes"
import "./src/hardening"
import "./src/staging"

export { catalogDatabaseUrl } from "./src/config"
export { validateLegacyRedirectZones } from "./src/web-routes"
export { validateIpEntry, buildIpClause } from "./src/staging"
export {
  wave0,
  catalogBucketName,
  tilesBucketName,
} from "./src/outputs"
