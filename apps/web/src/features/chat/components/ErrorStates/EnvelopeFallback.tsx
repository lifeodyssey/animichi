import { useChatActions } from "../../chat-actions";
import type { ChatDict } from "../../i18n";
import type { ChatErrorState } from "../../../../lib/chat/errorClassifier";
import { FallbackRetryButton } from "./FallbackRetryButton";

type Props = Readonly<{ state: ChatErrorState; dict: ChatDict }>;
type DictProps = Readonly<{ dict: ChatDict }>;

const CHIP_TONES = ["explore", "walk", "primary"] as const;

function SuggestionChips({ dict }: DictProps) {
  const { send } = useChatActions();
  const chips = dict.chips.map((chip, index) => (
    <button key={chip} type="button" className="chat-chip" data-tone={CHIP_TONES[index]} onClick={() => { send(chip); }}>
      {chip}
    </button>
  ));
  return <div className="chat-chips">{chips}</div>;
}

function RecognitionFallback({ dict }: DictProps) {
  return (
    <article className="chat-card chat-card--fallback-state" data-fallback="D1">
      <p className="chat-fallback__subtitle">{dict.errorStates.d1Subtitle}</p>
      <p className="chat-card__message">{dict.errorStates.d1Title}</p>
      <p className="chat-fallback__hint">{dict.errorStates.d1Hint}</p>
      <SuggestionChips dict={dict} />
    </article>
  );
}

function NoSpotsFallback({ dict }: DictProps) {
  return (
    <article className="chat-card chat-card--fallback-state" data-fallback="D2">
      <p className="chat-card__message">{dict.errorStates.d2Title}</p>
      <p className="chat-fallback__hint">{dict.errorStates.d2Hint}</p>
      <SuggestionChips dict={dict} />
    </article>
  );
}

function apologyCopy(state: "D5" | "D6", dict: ChatDict): { message: string; retry: string } {
  const states = dict.errorStates;
  if (state === "D5") return { message: states.d5Message, retry: states.d5Retry };
  return { message: states.d6Message, retry: states.d6Retry };
}

function ApologyFallback({ state, dict }: Readonly<{ state: "D5" | "D6"; dict: ChatDict }>) {
  const { regenerate } = useChatActions();
  const copy = apologyCopy(state, dict);
  return (
    <article className="chat-card chat-card--fallback-state" data-fallback={state} role="alert">
      <p className="chat-card__message">{copy.message}</p>
      <FallbackRetryButton label={copy.retry} onClick={regenerate} className="chat-fallback__retry" />
    </article>
  );
}

/**
 * Settled-envelope fallbacks (D1 recognition failure, D2 zero spots, D5/D6
 * apologies). Copy comes exclusively from the dictionary — wire error details
 * (ModelRetry, output_validator, codes) never reach the DOM.
 */
export function EnvelopeFallback({ state, dict }: Props) {
  if (state === "D1") return <RecognitionFallback dict={dict} />;
  if (state === "D2") return <NoSpotsFallback dict={dict} />;
  return <ApologyFallback state={state === "D5" ? "D5" : "D6"} dict={dict} />;
}
