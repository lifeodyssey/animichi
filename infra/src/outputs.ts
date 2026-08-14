import * as pulumi from "@pulumi/pulumi";
import { catalogMediaBucket, catalogSnapshotBucket, mapTilesBucket } from "./buckets.ts"

export const wave0 = pulumi.output("spike-validated");
export const catalogBucketName = catalogMediaBucket.name;
export const tilesBucketName = mapTilesBucket.name;
export const snapshotBucketName = catalogSnapshotBucket.name;
