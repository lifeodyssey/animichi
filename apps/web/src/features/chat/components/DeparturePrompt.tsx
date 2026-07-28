import { useCallback, useState } from "react";
import type { ChatDict } from "../i18n";
import { LocationPrompt } from "./LocationPrompt";

/** C2t departure chips (issue #260 AC2): 駅から+time / 現在地 / manual / おまかせ.
 * The 現在地 chip swaps in the C4 LocationPrompt, so denial degrades to
 * manual entry through the same component (AC3). */

export type DepartureChipKind = "station" | "manual" | "auto";

type Props = Readonly<{
  dict: ChatDict;
  onChip: (kind: DepartureChipKind) => void;
  onLocated: (lat: number, lng: number) => void;
  onManualLocation: (text: string) => void;
}>;

type ChipProps = Readonly<{ label: string; onPick: () => void }>;

function Chip({ label, onPick }: ChipProps) {
  return (
    <button type="button" className="chat-departure__chip" onClick={onPick}>
      {label}
    </button>
  );
}

function useChips({ onChip }: Pick<Props, "onChip">) {
  const station = useCallback(() => { onChip("station"); }, [onChip]);
  const manual = useCallback(() => { onChip("manual"); }, [onChip]);
  const auto = useCallback(() => { onChip("auto"); }, [onChip]);
  return { station, manual, auto };
}

type Chips = ReturnType<typeof useChips>;

function chipItems(dict: ChatDict, chips: Chips, onHere: () => void): readonly ChipProps[] {
  return [
    { label: dict.departure.stationChip, onPick: chips.station },
    { label: dict.departure.hereChip, onPick: onHere },
    { label: dict.departure.manualChip, onPick: chips.manual },
    { label: dict.departure.autoChip, onPick: chips.auto },
  ];
}

function ChipRow({ dict, chips, onHere }: Readonly<{ dict: ChatDict; chips: Chips; onHere: () => void }>) {
  return (
    <>
      <p className="chat-departure__prompt">{dict.departure.prompt}</p>
      {chipItems(dict, chips, onHere).map((item) => <Chip key={item.label} {...item} />)}
    </>
  );
}

function LocatingPanel({ dict, onLocated, onManualLocation }: Readonly<Omit<Props, "onChip">>) {
  return (
    <div className="chat-departure" role="group" aria-label={dict.departure.prompt}>
      <LocationPrompt dict={dict} onLocated={onLocated} onManual={onManualLocation} />
    </div>
  );
}

export function DeparturePrompt({ dict, onChip, onLocated, onManualLocation }: Props) {
  const [locating, setLocating] = useState(false);
  const chips = useChips({ onChip });
  if (locating) return <LocatingPanel dict={dict} onLocated={onLocated} onManualLocation={onManualLocation} />;
  return (
    <div className="chat-departure" role="group" aria-label={dict.departure.prompt}>
      <ChipRow dict={dict} chips={chips} onHere={() => { setLocating(true); }} />
    </div>
  );
}
