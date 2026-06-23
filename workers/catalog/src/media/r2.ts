/**
 * Thin typed wrapper over the Cloudflare R2Bucket binding.
 *
 * The lazy-R2 media path (see `img.ts`) uploads each point photo exactly once on
 * its first request, then serves every subsequent hit from R2. These helpers are
 * the only place that touches the raw `R2Bucket` API so the rest of the media
 * code stays binding-agnostic and fully typed (no `any`).
 */

/** Store an image body in R2 under `key` with its content type. */
export async function putImage(
  bucket: R2Bucket,
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  await bucket.put(key, body, { httpMetadata: { contentType } });
}

/** Fetch a stored image object from R2 (null when the key is absent). */
export async function getImage(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}
