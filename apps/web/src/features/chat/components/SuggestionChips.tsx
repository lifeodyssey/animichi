import type { ChatChipKind, ChatDict } from "../i18n";

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
const CHIP_TONE: Readonly<Record<ChatChipKind, string | undefined>> = {
  example: undefined,
  nearbySearch: "primary",
};

/** The `dict.chips` row, shared by the A1 cold start and the D1 fallback. */
export function SuggestionChips({ dict, onPick, disabled }: Props) {
  const chips = dict.chips.map((chip) => (
    <button key={chip.text} type="button" className="chat-chip" data-tone={CHIP_TONE[chip.kind]} disabled={disabled} onClick={() => { onPick(chip.text); }}>
      {chip.text}
    </button>
  ));
  return <div className="chat-chips">{chips}</div>;
}
