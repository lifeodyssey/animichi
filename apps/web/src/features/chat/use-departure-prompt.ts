import { useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { sendWithOriginOf } from "./chat-actions";
import type { ChatActions } from "./chat-actions";
import type { DepartureChipKind } from "./components/DeparturePrompt";
import { needsDeparturePrompt } from "./departure";
import type { ChatDict } from "./i18n";

/** C2t interception (issue #260 AC2): a route request missing both departure
 * point and time is held while the chips ask; any chip resolves the held turn.
 * The manual chip lets the very next send pass unguarded so the user can
 * restate the request their own way without being re-prompted. */
export interface DeparturePromptState {
  readonly pending: string | null;
  readonly onSend: (text: string) => void;
  readonly onChip: (kind: DepartureChipKind) => void;
  readonly onLocated: (lat: number, lng: number) => void;
  readonly onManualLocation: (text: string) => void;
}

type SetPending = (pending: string | null) => void;
type SkipRef = RefObject<boolean>;

function chipText(kind: DepartureChipKind, pending: string, dict: ChatDict): string {
  if (kind === "station") return `${pending}${dict.departure.stationSuffix}`;
  return pending;
}

function makeOnSend(actions: ChatActions, skipOnce: SkipRef, setPending: SetPending) {
  return (text: string) => {
    if (!skipOnce.current && needsDeparturePrompt(text)) {
      setPending(text);
      return;
    }
    skipOnce.current = false;
    actions.send(text);
  };
}

function resolveChip(kind: DepartureChipKind, pending: string | null, dict: ChatDict, skipOnce: SkipRef): string | null {
  if (kind === "manual") {
    skipOnce.current = true;
    return null;
  }
  return pending === null ? null : chipText(kind, pending, dict);
}

function makeOnChip(actions: ChatActions, dict: ChatDict, pending: string | null, skipOnce: SkipRef, setPending: SetPending) {
  return (kind: DepartureChipKind) => {
    setPending(null);
    const text = resolveChip(kind, pending, dict, skipOnce);
    if (text !== null) actions.send(text);
  };
}

function makeOnLocated(actions: ChatActions, pending: string | null, setPending: SetPending) {
  return (lat: number, lng: number) => {
    setPending(null);
    if (pending !== null) sendWithOriginOf(actions)(pending, lat, lng);
  };
}

function makeOnManualLocation(actions: ChatActions, pending: string | null, setPending: SetPending) {
  return (text: string) => {
    setPending(null);
    if (pending !== null) actions.send(`${pending} — ${text}`);
  };
}

export function useDeparturePrompt(actions: ChatActions, dict: ChatDict): DeparturePromptState {
  const [pending, setPending] = useState<string | null>(null);
  const skipOnce = useRef(false);
  const onSend = useMemo(() => makeOnSend(actions, skipOnce, setPending), [actions]);
  const onChip = useMemo(() => makeOnChip(actions, dict, pending, skipOnce, setPending), [actions, dict, pending]);
  const onLocated = useMemo(() => makeOnLocated(actions, pending, setPending), [actions, pending]);
  const onManualLocation = useMemo(() => makeOnManualLocation(actions, pending, setPending), [actions, pending]);
  return { pending, onSend, onChip, onLocated, onManualLocation };
}
