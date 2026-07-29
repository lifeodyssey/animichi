import type { ChatDict } from "../i18n";
import { FoxAvatar } from "./FoxAvatar";

type Props = Readonly<{
  dict: ChatDict;
  onChip: (text: string) => void;
  disabled?: boolean;
}>;

const CHIP_TONES = ["explore", "walk", "primary"] as const;

function ExampleChips({ dict, onChip, disabled }: Props) {
  const chips = dict.chips.map((chip, index) => (
    <button key={chip} type="button" className="chat-chip" data-tone={CHIP_TONES[index]} disabled={disabled} onClick={() => { onChip(chip); }}>
      {chip}
    </button>
  ));
  return <div className="chat-chips">{chips}</div>;
}

function FoxGreeting({ dict }: Readonly<{ dict: ChatDict }>) {
  return (
    <div className="chat-greeting">
      <FoxAvatar pose="guide" alt={dict.foxAlt} />
      <p className="chat-bubble chat-bubble--ai">{dict.greeting}</p>
    </div>
  );
}

/** A1 cold start: fox greeting bubble + 3 nook tri-color example chips. */
export function ColdStart(props: Props) {
  return (
    <div className="chat-cold-start">
      <FoxGreeting dict={props.dict} />
      <ExampleChips {...props} />
    </div>
  );
}
