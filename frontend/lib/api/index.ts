// Barrel re-export: all api module exports via a single import path.
// All existing `from "*/lib/api"` imports continue to work unchanged.

export { hydrateResponseData, fetchPopularBangumi } from "./client";
export type { PopularBangumiEntry } from "./client";

export {
  buildSelectedRouteActionText,
  sendMessage,
  sendSelectedRoute,
  sendMessageStream,
  parseSSEChunk,
} from "./runtime";
export type { StreamEventPayload } from "./runtime";

export {
  fetchConversations,
  fetchConversationMessages,
  patchConversationTitle,
} from "./conversations";
export type { ConversationMessage } from "./conversations";

export { fetchRouteHistory } from "./routes";
export type { RouteHistoryEntry } from "./routes";

export { submitFeedback } from "./feedback";

export { fetchSearchPreview } from "./search-preview";
export type { SearchPreviewResponse } from "./search-preview";

export { fetchAnimeGuide } from "./guide";
export type { AnimeGuideResponse } from "./guide";
