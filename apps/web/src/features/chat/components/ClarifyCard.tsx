import type { ChatDataPart } from "@animichi/contract";
import { useCallback, useEffect, useState } from "react";
import { sendWithOriginOf, useChatActions } from "../ChatActions";
import type { ChatDict } from "../i18n";
import { useClarifyPick } from "../selection/use-clarify-pick";
import type { ClarifyPickTurn } from "../selection/use-clarify-pick";
import type { IntentCardProps } from "./Cards";
import { candidatesOf } from "./Cards";
import { LocationPrompt } from "./LocationPrompt";

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
type OptionState = "available" | "selected" | "unselected" | "dismissed";

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
 * Bilingual display title (W1 #1220): `中文(原文)` when a Chinese title
 * exists, the original alone otherwise. Display-layer composition only —
 * what a pick SENDS is the candidate id, decoupled from any language.
 */
export function candidateDisplayTitle(candidate: Candidate): string {
  const original = candidate.title ?? candidate.id ?? "";
  const chinese = candidate.title_cn;
  if (chinese === undefined || chinese === "" || chinese === original) return original;
  if (original === "") return chinese;
  return `${chinese}(${original})`;
}

function optionState(phase: Phase, key: string): OptionState {
  if (phase.kind === "open") return "available";
  if (phase.kind === "rephrase") return "dismissed";
  return phase.id === key ? "selected" : "unselected";
}

function optionClass(phase: Phase, key: string): string {
  const state = optionState(phase, key);
  return state === "selected" || state === "available" ? "chat-clarify__option" : "chat-clarify__option chat-clarify__option--faded";
}

type OptionProps = Readonly<{
  candidate: Candidate;
  phase: Phase;
  onChoose: (candidate: Candidate) => void;
}>;

function CandidateOption({ candidate, phase, onChoose }: OptionProps) {
  const key = candidateKey(candidate);
  return (
    <li>
      <button type="button" className={optionClass(phase, key)} data-state={optionState(phase, key)} disabled={phase.kind !== "open"} onClick={() => { onChoose(candidate); }}>
        {candidateDisplayTitle(candidate)}
      </button>
    </li>
  );
}

type EscapeProps = Readonly<{ label: string; disabled: boolean; onEscape: () => void }>;

function EscapeHatch({ label, disabled, onEscape }: EscapeProps) {
  return (
    <button type="button" className="chat-clarify__escape" disabled={disabled} onClick={onEscape}>
      {label}
    </button>
  );
}

function PhotoQuestion({ reason, dict }: Readonly<{ reason: string | undefined; dict: ChatDict }>) {
  if (reason !== "photo_unrecognized") return null;
  return <p className="chat-clarify__question">{dict.clarify.question}</p>;
}

type LocationSectionProps = Readonly<{ reason: string | undefined; dict: ChatDict }>;

/** `missing_location` clarifications embed the C4 prompt (AC3). */
function LocationSection({ reason, dict }: LocationSectionProps) {
  const actions = useChatActions();
  const onLocated = useCallback((lat: number, lng: number) => {
    sendWithOriginOf(actions)(dict.location.granted, lat, lng);
  }, [actions, dict]);
  if (reason !== "missing_location") return null;
  return <LocationPrompt dict={dict} onLocated={onLocated} onManual={actions.send} />;
}

/** Route an id-carrying candidate through the structured channel; report
 * whether it was taken so the caller can fall back to free text. */
function structuredPick(pickTurn: ClarifyPickTurn, candidate: Candidate, clarificationId: number | undefined): boolean {
  if (!pickTurn.enabled || candidate.id === undefined) return false;
  pickTurn.pick({ candidateId: candidate.id, label: candidateDisplayTitle(candidate), clarificationId });
  return true;
}

type SetPhase = (phase: Phase) => void;

function useChoose(part: ChatDataPart, pickTurn: ClarifyPickTurn, send: (text: string) => void, setPhase: SetPhase) {
  return useCallback((candidate: Candidate) => {
    if (!pickTurn.sendable) return;
    setPhase({ kind: "chosen", id: candidateKey(candidate) });
    if (!structuredPick(pickTurn, candidate, clarificationIdOf(part))) send(candidateDisplayTitle(candidate));
  }, [part, pickTurn, send, setPhase]);
}

/** A failed pick re-arms this card so the visitor can pick again (W1 #1220). */
function useRearmOnPickFailure(phase: Phase, pickTurn: ClarifyPickTurn, setPhase: SetPhase): void {
  const failedPickId = pickTurn.status === "failed" ? pickTurn.lastPick?.candidateId : undefined;
  useEffect(() => {
    if (phase.kind === "chosen" && failedPickId === phase.id) setPhase({ kind: "open" });
  }, [phase, failedPickId, setPhase]);
}

function useClarifyPhase(part: ChatDataPart) {
  const { send } = useChatActions();
  const pickTurn = useClarifyPick();
  const [phase, setPhase] = useState<Phase>({ kind: "open" });
  const choose = useChoose(part, pickTurn, send, setPhase);
  const escape = useCallback(() => { setPhase({ kind: "rephrase" }); }, []);
  useRearmOnPickFailure(phase, pickTurn, setPhase);
  return { phase, choose, escape };
}

function ManualChip({ reason, dict, phase, onEscape }: LocationSectionProps & Readonly<{ phase: Phase; onEscape: () => void }>) {
  if (reason !== "photo_unrecognized") return null;
  return <EscapeHatch label={dict.clarify.manualChip} disabled={phase.kind !== "open"} onEscape={onEscape} />;
}

type ListProps = Readonly<{ candidates: readonly Candidate[]; phase: Phase; onChoose: (candidate: Candidate) => void }>;

function CandidateList({ candidates, phase, onChoose }: ListProps) {
  return (
    <ul className="chat-card__candidates" aria-label="candidates">
      {candidates.map((candidate) => (
        <CandidateOption key={candidateKey(candidate)} candidate={candidate} phase={phase} onChoose={onChoose} />
      ))}
    </ul>
  );
}

function RephraseHint({ phase, dict }: Readonly<{ phase: Phase; dict: ChatDict }>) {
  if (phase.kind !== "rephrase") return null;
  return <p className="chat-clarify__hint" role="status">{dict.clarify.rephraseHint}</p>;
}

type FooterProps = LocationSectionProps & Readonly<{ phase: Phase; onEscape: () => void }>;

function ClarifyFooter({ reason, dict, phase, onEscape }: FooterProps) {
  return (
    <>
      <EscapeHatch label={dict.clarify.escapeHatch} disabled={phase.kind !== "open"} onEscape={onEscape} />
      <ManualChip reason={reason} dict={dict} phase={phase} onEscape={onEscape} />
      <RephraseHint phase={phase} dict={dict} />
      <LocationSection reason={reason} dict={dict} />
    </>
  );
}

export function ClarifyCard({ part, dict }: IntentCardProps) {
  const { phase, choose, escape } = useClarifyPhase(part);
  return (
    <div className="chat-clarify">
      <PhotoQuestion reason={reasonOf(part)} dict={dict} />
      <CandidateList candidates={candidatesOf(part).slice(0, MAX_CANDIDATE_BUTTONS)} phase={phase} onChoose={choose} />
      <ClarifyFooter reason={reasonOf(part)} dict={dict} phase={phase} onEscape={escape} />
    </div>
  );
}
