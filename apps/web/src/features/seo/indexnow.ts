/**
 * IndexNow key (S0-v2 C5).
 *
 * The key is public by design: IndexNow requires the key file to be
 * fetchable at `/public/<key>.txt` so search engines can verify ownership
 * before accepting URL-submission pings. It is committed as a fixed value —
 * not derived from an env var — so the file and the ping signature stay
 * identical across every deploy and rebuild.
 *
 * The counterpart file lives at `public/INDEXNOW_KEY_FILE`; the
 * static-files suite asserts the two never drift apart.
 */
export const INDEXNOW_KEY = "ab12ab12ab12ab12ab12ab12ab12ab12";
export const INDEXNOW_KEY_FILE = `${INDEXNOW_KEY}.txt`;
