import type { ChatDataPart } from "@animichi/contract";
import { useCallback, useState } from "react";
import { sendWithOriginOf, useChatActions } from "../chat-actions";
import type { ChatDict } from "../i18n";
import type { IntentCardProps } from "./cards";
import { candidatesOf } from "./cards";
import { LocationPrompt } from "./LocationPrompt";

/** C2 clarification card (issue #260 AC1/AC5): 2-4 candidate buttons plus an
 * escape hatch; selecting one sends it (becoming a user bubble) and fades the
 * rest. Photo-search misses reuse this same branch with a manual-entry chip. */

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

function candidateKey(candidate: Candidate): string {
  return candidate.id ?? candidate.title ?? "";
}

function optionClass(phase: Phase, key: string): string {
  const faded =
    phase.kind === "rephrase" || (phase.kind === "chosen" && phase.id !== key);
  return faded ? "chat-clarify__option chat-clarify__option--faded" : "chat-clarify__option";
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
      <button type="button" className={optionClass(phase, key)} disabled={phase.kind !== "open"} onClick={() => { onChoose(candidate); }}>
        {candidate.title}
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

function useClarifyPhase(send: (text: string) => void) {
  const [phase, setPhase] = useState<Phase>({ kind: "open" });
  const choose = useCallback((candidate: Candidate) => {
    setPhase({ kind: "chosen", id: candidateKey(candidate) });
    send(candidate.title ?? candidateKey(candidate));
  }, [send]);
  const escape = useCallback(() => { setPhase({ kind: "rephrase" }); }, []);
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
  const { phase, choose, escape } = useClarifyPhase(useChatActions().send);
  return (
    <div className="chat-clarify">
      <PhotoQuestion reason={reasonOf(part)} dict={dict} />
      <CandidateList candidates={candidatesOf(part).slice(0, MAX_CANDIDATE_BUTTONS)} phase={phase} onChoose={choose} />
      <ClarifyFooter reason={reasonOf(part)} dict={dict} phase={phase} onEscape={escape} />
    </div>
  );
}
