import { useCallback, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { requestGeoPermission } from "../../../platform/geo";
import type { GeoPermission } from "../../../platform/geo";
import type { ChatDict } from "../i18n";

/**
 * C4 location prompt (issue #260 AC3/AC8): the allow button goes through the
 * platform adaptation layer, and a denial degrades to manual text entry —
 * never a dead end.
 */
type Props = Readonly<{
  dict: ChatDict;
  onLocated: (lat: number, lng: number) => void;
  onManual: (text: string) => void;
}>;

type ManualProps = Readonly<Omit<Props, "onLocated">>;
type Phase = "idle" | "denied";
type Submittable = Readonly<{ preventDefault: () => void }>;

function makeManualSubmit(text: string, onManual: (t: string) => void) {
  return (event: Submittable) => {
    event.preventDefault();
    if (text.trim() === "") return;
    onManual(text.trim());
  };
}

function useManualText(onManual: (text: string) => void) {
  const [text, setText] = useState("");
  const change = useCallback((event: ChangeEvent<HTMLInputElement>) => { setText(event.target.value); }, []);
  const submit = useMemo(() => makeManualSubmit(text, onManual), [text, onManual]);
  return { text, change, submit };
}

function ManualEntry({ dict, onManual }: ManualProps) {
  const manual = useManualText(onManual);
  return (
    <form className="chat-location__manual" onSubmit={manual.submit}>
      <input className="chat-location__input" value={manual.text} placeholder={dict.location.manualPlaceholder} aria-label={dict.location.manualPlaceholder} onChange={manual.change} />
      <button type="submit" className="chat-location__submit" disabled={manual.text.trim() === ""}>{dict.location.manualSubmit}</button>
    </form>
  );
}

function DeniedFallback({ dict, onManual }: ManualProps) {
  return (
    <div className="chat-location__denied">
      <p>{dict.location.denied}</p>
      <ManualEntry dict={dict} onManual={onManual} />
    </div>
  );
}

type Located = Props["onLocated"];
type SetPhase = (phase: Phase) => void;

function settlePermission(permission: GeoPermission, onLocated: Located, setPhase: SetPhase): void {
  if (permission.status === "granted") onLocated(permission.lat, permission.lng);
  else setPhase("denied");
}

function makeAllow(onLocated: Located, setPhase: SetPhase) {
  return () => {
    void requestGeoPermission().then((permission) => { settlePermission(permission, onLocated, setPhase); });
  };
}

export function LocationPrompt({ dict, onLocated, onManual }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const allow = useMemo(() => makeAllow(onLocated, setPhase), [onLocated]);
  if (phase === "denied") return <DeniedFallback dict={dict} onManual={onManual} />;
  return (
    <button type="button" className="chat-location__allow" onClick={allow}>{dict.location.allow}</button>
  );
}
