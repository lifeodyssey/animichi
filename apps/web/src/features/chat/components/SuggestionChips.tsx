import type { ChatChipKind, ChatDict } from "../i18n";
import { AnimalButton } from "./AnimalButton";

type Props = Readonly<{
  dict: ChatDict;
  onPick: (text: string) => void;
  disabled?: boolean;
}>;

/**
 * Tone follows meaning, not position: an example of how to ask stays plain
 * paper (design sync `.chip2.work`), while a door into a capability wears that
 * capability's tone. `undefined` leaves the attribute off, so the base cream
 * chip is the example's whole styling.
 */
const CHIP_TONE: Readonly<Record<ChatChipKind, "paper" | "primary">> = {
  example: "paper",
  nearbySearch: "primary",
};

const CHIP_DATA_TONE: Readonly<Record<ChatChipKind, string | undefined>> = {
  example: undefined,
  nearbySearch: "primary",
};

/* Package rule #17 retheme: keep the 3D press mechanic (#19), re-colour it from
   our palette so the shadow reads warm on cream instead of package grey.
   Literal string only — Tailwind never resolves `${}` interpolation. */
const PRESS_SHADOW = "[--animal-shadow-press:0_5px_0_0_color-mix(in_srgb,var(--color-muted)_78%,var(--color-fg))] [--animal-shadow-press-hover:0_6px_0_0_color-mix(in_srgb,var(--color-muted)_78%,var(--color-fg))] [--animal-shadow-press-active:0_1px_0_0_color-mix(in_srgb,var(--color-muted)_78%,var(--color-fg))]";

/** The `dict.chips` row, shared by the A1 cold start and the D1 fallback. */
export function SuggestionChips({ dict, onPick, disabled }: Props) {
  const chips = dict.chips.map((chip) => (
    <AnimalButton key={chip.text} tone={CHIP_TONE[chip.kind]} data-tone={CHIP_DATA_TONE[chip.kind]} disabled={disabled} onClick={() => { onPick(chip.text); }}>
      {chip.text}
    </AnimalButton>
  ));
  return <div className={`chat-chips ${PRESS_SHADOW}`}>{chips}</div>;
}
