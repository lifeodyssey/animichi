import type { ChatDict } from "../i18n";
import { greetingRuns } from "../greeting";
import { FOX_IMAGES } from "./FoxAvatar";
import { SuggestionChips } from "./SuggestionChips";

type Props = Readonly<{
  dict: ChatDict;
  onChip: (text: string) => void;
  disabled?: boolean;
}>;

function HeroFox({ alt }: Readonly<{ alt: string }>) {
  return (
    <img className="chat-cold-start__fox" src={FOX_IMAGES.guide} alt={alt} width={108} height={108} />
  );
}

/** The lead bubble carries the design's emphasis: the runs the dictionary
 * marks are bold, the rest is plain, and together they read as one sentence. */
function LeadBubble({ dict }: Readonly<{ dict: ChatDict }>) {
  const runs = greetingRuns(dict.greeting, dict.greetingEmphasis).map((run, index) => (
    run.emphasised ? <b key={`${String(index)}:${run.text}`}>{run.text}</b> : run.text
  ));
  return <p className="chat-cold-start__lead">{runs}</p>;
}

function ColdStartHero({ dict }: Readonly<{ dict: ChatDict }>) {
  return (
    <>
      <HeroFox alt={dict.foxAlt} />
      <h1 className="chat-cold-start__title">{dict.heroTitle}</h1>
      <LeadBubble dict={dict} />
      <p className="chat-cold-start__chips-label">{dict.chipsLabel}</p>
    </>
  );
}

/** A1 cold start: fox hero, the emphasised lead bubble, and the chip row. */
export function ColdStart({ dict, onChip, disabled }: Props) {
  return (
    <div className="chat-cold-start">
      <ColdStartHero dict={dict} />
      <SuggestionChips dict={dict} onPick={onChip} disabled={disabled} />
    </div>
  );
}
