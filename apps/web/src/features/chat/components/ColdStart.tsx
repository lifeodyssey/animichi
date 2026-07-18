import type { ChatDict } from "../i18n";

type Props = Readonly<{
  dict: ChatDict;
  onChip: (text: string) => void;
  disabled?: boolean;
}>;

function ExampleChips({ dict, onChip, disabled }: Props) {
  const chips = dict.chips.map((chip) => (
    <button key={chip} type="button" className="chat-chip" disabled={disabled} onClick={() => { onChip(chip); }}>
      {chip}
    </button>
  ));
  return <div className="chat-chips">{chips}</div>;
}

/** A1 cold start: Animichi greeting bubble + 3 nook-tile example chips. */
export function ColdStart(props: Props) {
  return (
    <div className="chat-cold-start">
      <p className="chat-bubble chat-bubble--ai">{props.dict.greeting}</p>
      <ExampleChips {...props} />
    </div>
  );
}
