// W0-S1 spike (#1244): the one tool the probe turn carries.
//
// It answers from a fixed table rather than the catalog Worker — S1 measures
// the pi kernel on workerd, not catalog latency — but it does hold its abort
// signal for `holdMs`, because the "abort mid tool call" break point is only
// real if the tool is genuinely in flight when the abort lands.

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";

const SPOTS: Record<string, string> = {
  hyouka: "Takayama, Gifu — Kamiyama Library and the Miyagawa morning market.",
  "your name": "Hida-Furukawa, Gifu — Ketawakamiya Shrine and the JR station stairs.",
  "k-on": "Toyosato, Shiga — the old Toyosato Elementary School building.",
};

const spotLookupParameters = Type.Object({
  title: Type.String({ description: "Anime title to look up pilgrimage spots for" }),
});

type SpotLookupParams = Static<typeof spotLookupParameters>;

function spotFor(title: string): string {
  return SPOTS[title.trim().toLowerCase()] ?? `No pilgrimage spot on file for ${title}.`;
}

function holdUntilAborted(holdMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, holdMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function createSpotLookupTool(holdMs: number): AgentTool<typeof spotLookupParameters> {
  return {
    name: "lookup_spot",
    label: "Look up a pilgrimage spot",
    description: "Return the real-world pilgrimage location for an anime title.",
    parameters: spotLookupParameters,
    execute: async (_toolCallId: string, params: SpotLookupParams, signal?: AbortSignal) => {
      await holdUntilAborted(holdMs, signal);
      signal?.throwIfAborted();
      return { content: [{ type: "text" as const, text: spotFor(params.title) }], details: {} };
    },
  };
}
