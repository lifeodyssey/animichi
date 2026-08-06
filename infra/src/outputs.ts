import * as pulumi from "@pulumi/pulumi";
import { catalogMediaBucket, mapTilesBucket } from "./buckets.ts";

export const wave0 = pulumi.output("spike-validated");
export const catalogBucketName = catalogMediaBucket.name;
export const tilesBucketName = mapTilesBucket.name;
