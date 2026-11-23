/**
 * The exact bodies the gateway answers today, byte for byte, for every refusal
 * the characterization pins reach. Written out literally rather than built from
 * `src/gateway/responses.ts`, so a change to a code, a message, a key order or
 * the JSON spacing turns a pin red instead of moving the expectation with it.
 */

export const NOT_FOUND = '{"error":{"code":"not_found","message":"No route matches this request."}}';
export const METHOD_NOT_ALLOWED = '{"error":{"code":"method_not_allowed","message":"Method not allowed."}}';
export const UNAUTHORIZED = '{"error":{"code":"unauthorized","message":"Valid credentials required."}}';
export const VERIFICATION_UNAVAILABLE =
  '{"error":{"code":"verification_unavailable","message":"Credentials could not be verified right now. Please retry; do not discard them."}}';
export const SHOWCASE_DENIED = '{"error":{"code":"showcase_denied","message":"Not available in showcase mode."}}';
export const TURNSTILE_REQUIRED =
  '{"error":{"code":"turnstile_required","message":"Turnstile verification required.","retryable":true}}';
export const RATE_LIMITED_60 =
  '{"error":{"code":"rate_limited","message":"リクエストが多いみたい。少し待ってね。","retry_after_seconds":60}}';
export const RATE_LIMITED_17 =
  '{"error":{"code":"rate_limited","message":"リクエストが多いみたい。少し待ってね。","retry_after_seconds":17}}';
export const RATE_LIMIT_UNAVAILABLE =
  '{"error":{"code":"rate_limit_unavailable","message":"Rate limiter temporarily unavailable. Please retry."}}';
export const BUDGET_EXHAUSTED =
  '{"error":{"code":"anon_budget_exhausted","message":"今日はここまで。ログインすると続きから一緒に旅の計画を立てられるよ。","action":"login"}}';
export const UNEXPECTED_QUERY = '{"error":{"code":"unexpected_query","message":"This route does not accept that query parameter."}}';
export const INTERNAL_ERROR = '{"error":{"code":"internal_error","message":"The gateway could not complete this request."}}';
export const IMAGE_PATH_INVALID = '{"error":{"code":"image_path_invalid","message":"The image path is not one this proxy serves."}}';
export const IMAGE_PLAN_REQUIRED =
  '{"error":{"code":"image_plan_required","message":"Public image requests must include a documented size plan."}}';
export const IMAGE_NOT_FOUND = '{"error":{"code":"image_not_found"}}';
export const IMAGE_METHOD_NOT_ALLOWED = '{"error":{"code":"image_method_not_allowed"}}';
export const IMAGE_STORAGE_UNAVAILABLE = '{"error":{"code":"image_storage_unavailable"}}';
export const TILE_NOT_FOUND = '{"error":{"code":"tile_not_found"}}';
export const TILE_METHOD_NOT_ALLOWED = '{"error":{"code":"tile_method_not_allowed"}}';
export const TILE_STORAGE_UNAVAILABLE = '{"error":{"code":"tile_storage_unavailable"}}';
export const CLIENT_SESSION_ID = '{"error":{"code":"invalid_request","message":"Client session ids are not accepted."}}';
