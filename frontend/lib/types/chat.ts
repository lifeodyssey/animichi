// ---------------------------------------------------------------------------
// AI SDK UIMessage types — shared between AppShell and downstream components.
// ---------------------------------------------------------------------------

import type { UIMessage } from "ai";

/** Metadata attached to assistant messages via messageMetadata / data parts. */
export interface SeichijunreiMetadata {
  session_id?: string;
  intent?: string;
  route_history?: Record<string, unknown>[];
  ui?: { component?: string };
}

/** Project-wide typed UIMessage with our custom metadata. */
export type SeichijunreiMessage = UIMessage<SeichijunreiMetadata>;
