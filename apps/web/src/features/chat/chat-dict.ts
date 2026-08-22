import type { ChatAppBarDict } from "./appbar-i18n";
import type { ChatByokDict } from "./byok-i18n";
import type {
  ChatClarifyDict,
  ChatDepartureDict,
  ChatLocationDict,
  ChatPhotoDict,
} from "./clarify-i18n";
import type { ChatErrorStatesDict } from "./error-states-i18n";
import type { ChatRouteDict } from "./route-i18n";
import type { ChatSearchDict } from "./search-i18n";
import type { ChatToolStepsDict } from "./tool-steps-i18n";
import type { ChatTurnstileDict } from "./turnstile-i18n";

/**
 * What a cold-start chip IS, which is what the design colours it by: an
 * `example` demonstrates how to ask and is drawn as plain paper, because its
 * content is a sample sentence rather than a feature; `nearbySearch` is a door
 * into a capability and wears that capability's tone. Kind travels with the
 * copy so the tone can never drift away from the meaning again.
 */
export type ChatChipKind = "example" | "nearbySearch";

export interface ChatChip {
  readonly text: string;
  readonly kind: ChatChipKind;
}

/** Chat-page copy, kept feature-local to avoid the shared dictionary hot file. */
export interface ChatDict {
  readonly greeting: string;
  /** Phrases the lead bubble sets in bold, in the order they appear. */
  readonly greetingEmphasis: readonly string[];
  /** A1 hero headline above the greeting bubble (design spec: empty-state hero). */
  readonly heroTitle: string;
  /** Label introducing the example chips. */
  readonly chipsLabel: string;
  readonly chips: readonly [ChatChip, ChatChip, ChatChip];
  readonly inputPlaceholder: string;
  /** G4: the placeholder while a turn is running — the field stays open. */
  readonly busyPlaceholder: string;
  readonly send: string;
  readonly errorBanner: string;
  readonly retry: string;
  readonly historyFootprint: string;
  readonly fallbackCard: string;
  readonly historyError: string;
  readonly preparing: string;
  readonly foxAlt: string;
  readonly thinking: string;
  readonly waitingSubtitle: string;
  readonly footprintDetails: string;
  /** E1 badge on a superseded living-document card (issues #271/#273). */
  readonly previousVersion: string;
  readonly appbar: ChatAppBarDict;
  readonly errorStates: ChatErrorStatesDict;
  readonly toolSteps: ChatToolStepsDict;
  readonly search: ChatSearchDict;
  readonly turnstile: ChatTurnstileDict;
  readonly route: ChatRouteDict;
  readonly clarify: ChatClarifyDict;
  readonly departure: ChatDepartureDict;
  readonly location: ChatLocationDict;
  readonly photo: ChatPhotoDict;
  readonly byok: ChatByokDict;
}
