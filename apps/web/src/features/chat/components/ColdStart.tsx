import type { ChatDict } from "../i18n";
import { FOX_IMAGES } from "./FoxAvatar";

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

function HeroFox({ alt }: Readonly<{ alt: string }>) {
  return (
    <img className="chat-cold-start__fox" src={FOX_IMAGES.guide} alt={alt} width={108} height={108} />
  );
}

function ColdStartHero({ dict }: Readonly<{ dict: ChatDict }>) {
  return (
    <>
      <HeroFox alt={dict.foxAlt} />
      <h1 className="chat-cold-start__title">{dict.heroTitle}</h1>
      <p className="chat-cold-start__lead">{dict.greeting}</p>
      <p className="chat-cold-start__chips-label">{dict.chipsLabel}</p>
    </>
  );
}

/** A1 cold start: fox hero, lead bubble, and 3 nook tri-color example chips. */
export function ColdStart(props: Props) {
  return (
    <div className="chat-cold-start">
      <ColdStartHero dict={props.dict} />
      <ExampleChips {...props} />
    </div>
  );
}
