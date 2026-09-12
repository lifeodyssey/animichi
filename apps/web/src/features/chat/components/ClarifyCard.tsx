import type { ChatDataPart } from "@animichi/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimalButton } from "./AnimalButton";
import { ClarifyCandidateOption } from "./ClarifyCandidateOption";
import type { ClarifyOptionState } from "./ClarifyCandidateOption";
import { sendWithOriginOf, useChatActions } from "../ChatActions";
import type { ChatDict } from "../i18n";
import { useClarifyPick } from "../selection/use-clarify-pick";
import type { ClarifyPickTurn } from "../selection/use-clarify-pick";
import type { IntentCardProps } from "./Cards";
import { candidatesOf } from "./Cards";
import { LocationPrompt } from "./LocationPrompt";
import { ClarifyDetails, clarificationPrompt } from "./ClarifyDetails";
import type { Locale } from "../../../i18n/locales";
import { localizedWorkTitle } from "../lib/work-title";

/** C2 clarification card (issue #260 AC1/AC5): 2-4 candidate buttons plus an
 * escape hatch; selecting one sends the candidate's id through whichever pick
 * channel is in scope while the user bubble shows the display title, and fades
 * the rest. On the session's channel (W1 #1220) that is the structured
 * `/v1/chat` selection, and a failed pick re-arms the card. Photo-search misses
 * reuse this same branch with a manual-entry chip, but scoped to the photo
 * offer's own channel, which confirms the offer instead (#1336). */

const MAX_CANDIDATE_BUTTONS = 4;

type Candidate = ReturnType<typeof candidatesOf>[number];
type Phase =
  | { readonly kind: "open" }
  | { readonly kind: "chosen"; readonly id: string }
  | { readonly kind: "rephrase" };

function reasonOf(part: ChatDataPart): string | undefined {
  const data = part.data;
  return data && "reason" in data ? data.reason : undefined;
}

/** The pending clarification's revision, echoed back with a pick. */
function clarificationIdOf(part: ChatDataPart): number | undefined {
  const data = part.data;
  return data && "clarification_id" in data ? data.clarification_id : undefined;
}

function candidateKey(candidate: Candidate): string {
  return candidate.id ?? candidate.title ?? "";
}

/**
 * Bilingual display title (W1 #1220): `主语言(另一语言)` in the reader's
 * locale order via localizedWorkTitle. Display-layer composition only —
 * what a pick SENDS is the candidate id, decoupled from any language.
 */
export function candidateDisplayTitle(candidate: Candidate, locale: Locale): string {
  const { primary, secondary } = localizedWorkTitle(candidate, locale);
  return secondary === undefined ? primary : `${primary}(${secondary})`;
}

function optionState(phase: Phase, key: string): ClarifyOptionState {
  if (phase.kind === "open") return "available";
  if (phase.kind === "rephrase") return "dismissed";
  return phase.id === key ? "selected" : "unselected";
}

type EscapeProps = Readonly<{ label: string; disabled: boolean; onEscape: () => void }>;

function EscapeHatch({ label, disabled, onEscape }: EscapeProps) {
  return (
    <div className="grid border-t border-border-soft pt-2">
      <AnimalButton appearance="text" className="chat-clarify__escape justify-self-start [min-height:44px]! [padding:8px_0]! [text-align:left]! [font-weight:600] [--animal-text-color:var(--color-primary-strong)] night:[--animal-text-color:var(--color-explore-fg)]" disabled={disabled} onClick={onEscape}>{label}</AnimalButton>
    </div>
  );
}

function ClarifyQuestion({ part, dict }: IntentCardProps) {
  const reason = reasonOf(part);
  if (part.message) return null;
  const prompt = candidatesOf(part).length > 0 && reason !== "photo_unrecognized" ? dict.clarify.choosePrompt : clarificationPrompt(reason, dict.clarify);
  return <h3 className="text-xl font-extrabold leading-snug text-fg [text-wrap:balance]">{prompt}</h3>;
}

type LocationSectionProps = Readonly<{ reason: string | undefined; dict: ChatDict }>;

/** `missing_location` clarifications embed the C4 prompt (AC3). */
function LocationSection({ dict }: Readonly<{ dict: ChatDict }>) {
  const actions = useChatActions();
  const { sendable } = useClarifyPick();
  const onLocated = useCallback((lat: number, lng: number) => {
    sendWithOriginOf(actions)(dict.location.granted, lat, lng);
  }, [actions, dict]);
  return <LocationPrompt dict={dict} disabled={!sendable} onLocated={onLocated} onManual={actions.send} />;
}

/** Route an id-carrying candidate through the structured channel; report
 * whether it was taken so the caller can fall back to free text. */
function structuredPick(pickTurn: ClarifyPickTurn, candidate: Candidate, clarificationId: number | undefined, locale: Locale): boolean {
  if (!pickTurn.enabled || candidate.id === undefined) return false;
  pickTurn.pick({ candidateId: candidate.id, label: candidateDisplayTitle(candidate, locale), clarificationId });
  return true;
}

type SetPhase = (phase: Phase) => void;

function useChoose({ part, dict }: IntentCardProps, pickTurn: ClarifyPickTurn, send: (text: string) => void, setPhase: SetPhase) {
  return useCallback((candidate: Candidate) => {
    if (!pickTurn.sendable) return;
    setPhase({ kind: "chosen", id: candidateKey(candidate) });
    if (!structuredPick(pickTurn, candidate, clarificationIdOf(part), dict.locale)) send(candidateDisplayTitle(candidate, dict.locale));
  }, [part, dict.locale, pickTurn, send, setPhase]);
}

/** A failed pick re-arms this card so the visitor can pick again (W1 #1220). */
function useRearmOnPickFailure(phase: Phase, pickTurn: ClarifyPickTurn, setPhase: SetPhase): void {
  const failedPickId = pickTurn.status === "failed" ? pickTurn.lastPick?.candidateId : undefined;
  useEffect(() => {
    if (phase.kind === "chosen" && failedPickId === phase.id) setPhase({ kind: "open" });
  }, [phase, failedPickId, setPhase]);
}

function useClarifyPhase(props: IntentCardProps) {
  const { send } = useChatActions();
  const pickTurn = useClarifyPick();
  const [phase, setPhase] = useState<Phase>({ kind: "open" });
  const choose = useChoose(props, pickTurn, send, setPhase);
  const escape = useCallback(() => { setPhase({ kind: "rephrase" }); }, []);
  const cancel = useCallback(() => { setPhase({ kind: "open" }); }, []);
  useRearmOnPickFailure(phase, pickTurn, setPhase);
  return { phase, choose, escape, cancel };
}

type ListProps = Readonly<{ candidates: readonly Candidate[]; locale: Locale; phase: Phase; onChoose: (candidate: Candidate) => void }>;

function CandidateList({ candidates, locale, phase, onChoose }: ListProps) {
  const { sendable } = useClarifyPick();
  const list = useChoiceFocus(phase);
  const showCover = candidates.some((candidate) => Boolean(candidate.cover_url));
  return (
    <ul ref={list} hidden={phase.kind === "rephrase"} className="grid w-full gap-3 p-0 [list-style:none] empty:hidden [&[hidden]]:[display:none]" aria-label="candidates">
      {candidates.map((candidate) => <ClarifyCandidateOption key={candidateKey(candidate)} candidate={candidate} locale={locale} label={candidateDisplayTitle(candidate, locale)} state={optionState(phase, candidateKey(candidate))} showCover={showCover} disabled={!sendable} onChoose={onChoose} />)}
    </ul>
  );
}

function useChoiceFocus(phase: Phase) {
  const list = useRef<HTMLUListElement>(null);
  const previous = useRef(phase.kind);
  useEffect(() => {
    if (previous.current === "rephrase" && phase.kind === "open") list.current?.querySelector("button")?.focus();
    previous.current = phase.kind;
  }, [phase.kind]);
  return list;
}

type FooterProps = LocationSectionProps & Readonly<{ phase: Phase; onEscape: () => void; onCancel: () => void; hasCandidates: boolean }>;

function ClarifyFooter({ reason, dict, phase, onEscape, onCancel, hasCandidates }: FooterProps) {
  const { sendable } = useClarifyPick();
  if (reason === "missing_location") return <LocationSection dict={dict} />;
  if (!hasCandidates || phase.kind === "rephrase") return <ClarifyDetails reason={reason} dict={dict} editing={phase.kind === "rephrase"} onCancel={hasCandidates ? onCancel : undefined} />;
  const label = reason === "photo_unrecognized" ? dict.clarify.manualChip : dict.clarify.escapeHatch;
  return <EscapeHatch label={label} disabled={phase.kind !== "open" || !sendable} onEscape={onEscape} />;
}

export function ClarifyCard({ part, dict }: IntentCardProps) {
  const { phase, choose, escape, cancel } = useClarifyPhase({ part, dict });
  return (
    <div className="chat-clarify grid w-full gap-3 data-[has-candidates=true]:gap-5" data-has-candidates={candidatesOf(part).length > 0}>
      <ClarifyQuestion part={part} dict={dict} />
      <CandidateList candidates={candidatesOf(part).slice(0, MAX_CANDIDATE_BUTTONS)} locale={dict.locale} phase={phase} onChoose={choose} />
      <ClarifyFooter reason={reasonOf(part)} dict={dict} phase={phase} onEscape={escape} onCancel={cancel} hasCandidates={candidatesOf(part).length > 0} />
    </div>
  );
}
