// W0-S2 spike (#1245): the mimo-v2.5 gateway-dialect vocabulary.
//
// pi resolves a model's OpenAI-compatible dialect in two steps
// (`node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`):
// `detectCompat()` guesses from `provider` + `baseUrl`, then `getCompat()`
// lets each field of `model.compat` override the guess. Neither mimo route is
// in that guess list — `api.xiaomimimo.com` matches nothing, so direct is
// treated as if it were api.openai.com, while `opencode.ai` matches the
// `isNonStandard` arm and lands on a different default set. So "the default"
// is not one thing, and the matrix has to name a route as well as a switch.
//
// The switches below are exactly the plain on/off fields of
// `OpenAICompletionsCompat` (pi-ai `dist/types.d.ts:458`) that shape a
// non-reasoning tool-calling round trip, which is the only turn shape this
// spike runs. Deliberately excluded, with reasons:
//   - `thinkingFormat`, `requiresThinkingAsText`,
//     `requiresReasoningContentOnAssistantMessages`,
//     `thinkingTokenBudgetField`, `supportsThinkingTokenBudget`,
//     `chatTemplateKwargs`, `chatTemplateArgs` — reasoning plumbing; the spike
//     model is declared `reasoning: false`, so flipping them measures nothing.
//   - `openRouterRouting`, `vercelGatewayRouting`, `zaiToolStream`,
//     `deferredToolsMode`, `cacheControlFormat`, `supportsOpenAIGrammarTools` —
//     other vendors' dialects, or structured values rather than switches.
//   - `sendSessionAffinityHeaders`, `sessionAffinityFormat`,
//     `supportsLongCacheRetention` — prompt-cache behaviour across turns; this
//     spike runs one turn, so a single measured turn cannot tell them apart.

import type { OpenAICompletionsCompat } from "@earendil-works/pi-ai";

export const MIMO_ROUTES = ["direct", "zen"] as const;
export type MimoRouteName = (typeof MIMO_ROUTES)[number];

export const BOOLEAN_SWITCHES = [
  "supportsStore",
  "supportsDeveloperRole",
  "supportsReasoningEffort",
  "supportsUsageInStreaming",
  "supportsFinishReason",
  "supportsStrictMode",
  "requiresToolResultName",
  "requiresAssistantAfterToolResult",
] as const;
export type BooleanSwitch = (typeof BOOLEAN_SWITCHES)[number];

export const MAX_TOKENS_FIELDS = ["max_tokens", "max_completion_tokens"] as const;
export type MaxTokensField = (typeof MAX_TOKENS_FIELDS)[number];

/** The subset of pi's compat surface this spike can flip, all optional. */
export type MimoCompat = Pick<OpenAICompletionsCompat, BooleanSwitch | "maxTokensField">;

export const COMPAT_SWITCH_NAMES: readonly string[] = [...BOOLEAN_SWITCHES, "maxTokensField"];

export function isMimoRoute(value: string): value is MimoRouteName {
  return MIMO_ROUTES.some((route) => route === value);
}
