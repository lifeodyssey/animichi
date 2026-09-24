/**
 * The cache lifetime the image surface publishes for a whole asset — a week in
 * the browser, a month at the edge.
 *
 * `/img/` has two sources (#1650): the Anitabi origin and the private
 * docs-asset bucket. They answer one URL space, so they answer one lifetime.
 * This is the origin arm's policy, shared rather than copied, so the second
 * source cannot publish a different one.
 */

export const IMAGE_CACHE_CONTROL = "public, max-age=604800, s-maxage=2592000";
