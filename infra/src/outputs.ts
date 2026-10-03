import { catalogMediaBucket, catalogSnapshotBucket, mapTilesBucket } from "./buckets.ts"
import { edgeKnobsNamespace } from "./knobs.ts"

export const catalogBucketName = catalogMediaBucket.name;
export const tilesBucketName = mapTilesBucket.name;
export const snapshotBucketName = catalogSnapshotBucket.name;

// The runtime-knob namespace id (#688), read by the operator to fill the
// stacked wrangler binding; it exists only after the first infra apply.
export const edgeKnobsNamespaceId = edgeKnobsNamespace.id;

// The staging Access service token, whose output NAMES are what the ESC
// environment imports through the `pulumi-stacks` provider (see staging-access.ts).
export { stagingAccessClientId, stagingAccessClientSecret } from "./staging-access.ts"
