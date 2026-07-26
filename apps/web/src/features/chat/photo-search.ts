import type { ChatDataPart } from "@seichijunrei/contract";
import { parseChatDataPart } from "./data-parts";

/** Photo-search client (issue #260): upload → `/v1/photo-search`, reply is a
 * chat-shaped envelope rendered through the same registry as text search. */

export type PhotoGuidance = "configure_vision_key" | "switch_vision_endpoint";

export type PhotoSearchOutcome =
  | { readonly kind: "part"; readonly part: ChatDataPart }
  | { readonly kind: "quota"; readonly guidance: PhotoGuidance };

export interface PhotoGps {
  readonly lat: number;
  readonly lng: number;
}

const SUPPORTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ENCODE_CHUNK = 0x2000;

export function isSupportedPhoto(file: File): boolean {
  return SUPPORTED_PHOTO_TYPES.has(file.type);
}

function encodeChunk(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

export async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
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
  return JSON.stringify({
    image_base64: await toBase64(file),
    mime_type: file.type,
    ...(gps ? { gps } : {}),
  });
}

function parseOutcome(payload: unknown): PhotoSearchOutcome {
  const part = parseChatDataPart(payload);
  if (part === null) throw new Error("photo_search_invalid_response");
  return { kind: "part", part };
}

async function postJson(baseUrl: string, path: string, body: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

async function quotaOutcome(response: Response): Promise<PhotoSearchOutcome> {
  return { kind: "quota", guidance: guidanceOf(await response.json()) };
}

export async function postPhotoSearch(
  baseUrl: string,
  file: File,
  gps?: PhotoGps,
): Promise<PhotoSearchOutcome> {
  const response = await postJson(baseUrl, "/v1/photo-search", await requestBody(file, gps));
  if (response.status === 429) return quotaOutcome(response);
  if (!response.ok) throw new Error("photo_search_failed");
  return parseOutcome(await response.json());
}

export interface PhotoConfirmSignals {
  readonly query_type: "anime_screenshot" | "real_world_photo";
  readonly gps_available: boolean;
  readonly layer_hit: "1" | "2" | "none";
  readonly candidates_shown: number;
}

/** Fire-and-forget `user_confirmed` telemetry ping (AC11). */
export function confirmPhotoSearch(baseUrl: string, signals: PhotoConfirmSignals): void {
  void postJson(baseUrl, "/v1/photo-search/confirm", JSON.stringify(signals)).catch(() => undefined);
}
