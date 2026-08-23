import type { Locale } from "../../i18n/locales";
import { CHAT_DICTIONARIES } from "./chat-dictionaries";
import { TOOL_STEP_KEYS } from "./tool-steps-i18n";
import type { ChatDict } from "./chat-dict";
import type { ToolStepKey } from "./tool-steps-i18n";

/**
 * The chat feature's copy registry: which dictionary a locale gets, and the
 * one lookup that turns a tool name into its badge label. The copy itself
 * lives in the per-concern `*-i18n.ts` modules and the three dictionaries in
 * `chat-dictionaries.ts`; this module only names them for the rest of the
 * feature, which is why every consumer still imports from here.
 */
export type { ChatAppBarDict } from "./appbar-i18n";
export type { ChatByokDict } from "./byok-i18n";
export type {
  ChatClarifyDict,
  ChatDepartureDict,
  ChatLocationDict,
  ChatPhotoDict,
} from "./clarify-i18n";
export type { ChatErrorStatesDict } from "./error-states-i18n";
export type { ChatRouteDict } from "./route-i18n";
export type { ChatSearchDict } from "./search-i18n";
export type { ChatChip, ChatChipKind, ChatDict } from "./chat-dict";
export type { ChatToolStepsDict, ToolStepKey } from "./tool-steps-i18n";
export type { ChatTurnstileDict } from "./turnstile-i18n";
export { HIDDEN_TOOL_STEPS, TOOL_STEP_KEYS } from "./tool-steps-i18n";

export function chatDictFor(locale: Locale): ChatDict {
  return CHAT_DICTIONARIES[locale];
}

function isToolStepKey(name: string): name is ToolStepKey {
  return (TOOL_STEP_KEYS as readonly string[]).includes(name);
}

export function toolStepLabel(dict: ChatDict, name: string): string {
  if (isToolStepKey(name)) return dict.toolSteps.labels[name];
  return dict.toolSteps.fallback;
}
