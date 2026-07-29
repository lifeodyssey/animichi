import type { ChatDataPart } from "@seichijunrei/contract";
import type { Locale } from "../../i18n/locales";
import { sanitizePhoto } from "../shiori/exifStrip";
import { parseChatDataPart } from "./data-parts";
import { sessionHeaders } from "./session-headers";

/** Photo-search client (issue #260): upload → `/v1/photo-search`, reply is a
 * chat-shaped envelope rendered through the same registry as text search.
 * Requests carry the shared session headers (auth / Turnstile / session id)
 * plus `x-locale`, and every photo is EXIF-stripped before leaving the
 * browser — GPS reaches the backend only through the explicit `gps` field. */

export type PhotoGuidance = "configure_vision_key" | "switch_vision_endpoint";

export type PhotoSearchOutcome =
  | { readonly kind: "part"; readonly part: ChatDataPart }
  | { readonly kind: "quota"; readonly guidance: PhotoGuidance };

export interface PhotoGps {
  readonly lat: number;
  readonly lng: number;
}

export interface PhotoSearchContext {
  readonly locale: Locale;
  /** Read at request time so the server-assigned chat session id is current. */
  readonly sessionIdOf?: () => string | undefined;
  readonly gps?: PhotoGps;
}

/** Mirrors the backend's typed 413 limit; checked before the file is read. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const SUPPORTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ENCODE_CHUNK = 0x2000;

export function isSupportedPhoto(file: File): boolean {
  return SUPPORTED_PHOTO_TYPES.has(file.type);
}

export function isOversizedPhoto(file: File): boolean {
  return file.size > MAX_PHOTO_BYTES;
}

function encodeChunk(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

export async function toBase64(photo: Blob): Promise<string> {
  const bytes = new Uint8Array(await photo.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += ENCODE_CHUNK) {
    binary += encodeChunk(bytes.subarray(offset, offset + ENCODE_CHUNK));
  }
  return btoa(binary);
}

function fieldOf(value: unknown, key: string): unknown {
  if (typeof value === "object" && value !== null && key in value) {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}

function guidanceOf(body: unknown): PhotoGuidance {
  const guidance = fieldOf(fieldOf(fieldOf(body, "error"), "details"), "guidance");
  return guidance === "switch_vision_endpoint" ? guidance : "configure_vision_key";
}

async function requestBody(file: File, gps: PhotoGps | undefined): Promise<string> {
  const stripped = await sanitizePhoto(file);
  return JSON.stringify({
    image_base64: await toBase64(stripped),
    mime_type: file.type,
    ...(gps ? { gps } : {}),
  });
}

function parseOutcome(payload: unknown): PhotoSearchOutcome {
  const part = parseChatDataPart(payload);
  if (part === null) throw new Error("photo_search_invalid_response");
  return { kind: "part", part };
}

async function photoHeaders(context: PhotoSearchContext): Promise<Record<string, string>> {
  return {
    ...(await sessionHeaders(context.sessionIdOf?.())),
    "x-locale": context.locale,
    "Content-Type": "application/json",
  };
}

async function postJson(baseUrl: string, path: string, body: string, context: PhotoSearchContext): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: await photoHeaders(context),
    body,
  });
}

async function quotaOutcome(response: Response): Promise<PhotoSearchOutcome> {
  return { kind: "quota", guidance: guidanceOf(await response.json()) };
}

/** The armed edge's rejection code (`worker/turnstile.ts`, #447). */
export const PHOTO_CHALLENGED = "photo_search_challenged";

async function errorCodeOf(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json().catch(() => undefined);
  const code = fieldOf(fieldOf(body, "error"), "code");
  return typeof code === "string" ? code : undefined;
}

/** A challenged upload is not a broken upload: #445 put photo search on the
 * anonymous allowlist, so the armed gate rejects it exactly like a chat turn
 * and the visitor needs the challenge copy, not "photo search failed". */
async function rejection(response: Response): Promise<never> {
  const code = await errorCodeOf(response);
  throw new Error(code === "turnstile_required" ? PHOTO_CHALLENGED : "photo_search_failed");
}

async function settleResponse(response: Response): Promise<PhotoSearchOutcome> {
  if (response.status === 429) return quotaOutcome(response);
  if (!response.ok) return rejection(response);
  return parseOutcome(await response.json());
}

export async function postPhotoSearch(
  baseUrl: string,
  file: File,
  context: PhotoSearchContext,
): Promise<PhotoSearchOutcome> {
  const body = await requestBody(file, context.gps);
  return settleResponse(await postJson(baseUrl, "/v1/photo-search", body, context));
}

export interface PhotoConfirmSignals {
  readonly query_type: "anime_screenshot" | "real_world_photo";
  readonly gps_available: boolean;
  readonly layer_hit: "1" | "2" | "none";
  readonly candidates_shown: number;
}

/** Fire-and-forget `user_confirmed` telemetry ping (AC11). */
export function confirmPhotoSearch(
  baseUrl: string,
  signals: PhotoConfirmSignals,
  context: PhotoSearchContext,
): void {
  void postJson(baseUrl, "/v1/photo-search/confirm", JSON.stringify(signals), context)
    .catch(() => undefined);
}
