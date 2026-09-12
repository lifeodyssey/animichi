import { Button } from "animal-island-ui-tailwind/button";
import { useChatActions } from "../../ChatActions";
import type { ChatDict } from "../../i18n";
import type { ChatErrorState } from "../../lib/error-classifier";
import { ProgressGlyph } from "../ProgressGlyph";
import { FallbackSearchEntry } from "./FallbackSearchEntry";
import { FallbackMessage } from "./FallbackMessage";

type Props = Readonly<{ state: ChatErrorState; dict: ChatDict }>;
type DictProps = Readonly<{ dict: ChatDict }>;
const SURFACE = "grid w-full max-w-[452px] gap-5 py-1 text-fg";
const RETRY = "justify-self-start [height:auto]! [min-height:44px]! [padding:10px_16px]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! [--animal-bg-color:var(--color-paper)] [--animal-text-color:var(--color-fg)] [--animal-border-color:var(--color-border-soft)] focus-visible:outline-primary-strong motion-reduce:transition-none!";

function RecognitionFallback({ dict }: DictProps) {
  const copy = dict.errorStates;
  return <article className={SURFACE} data-fallback="D1">
    <FallbackMessage kind="search" title={copy.d1Title} hint={copy.d1Hint} />
    <FallbackSearchEntry label={copy.d1Label} placeholder={copy.d1Placeholder} submitLabel={copy.d1Submit} sentLabel={copy.d1Sent} />
  </article>;
}

/** Coordinate-less results still exist; only the map is unavailable. */
export function NoSpotsContent({ dict, hasUnlocatedSpots = false }: DictProps & Readonly<{ hasUnlocatedSpots?: boolean }>) {
  const copy = dict.errorStates;
  if (hasUnlocatedSpots) return <FallbackMessage kind="place" title={copy.d2UnlocatedTitle} hint={copy.d2UnlocatedHint} />;
  return <div className="grid gap-5">
    <FallbackMessage kind="place" title={copy.d2Title} hint={copy.d2Hint} />
    <FallbackSearchEntry label={copy.d2Label} placeholder={copy.d2Placeholder} submitLabel={copy.d2Submit} sentLabel={copy.d2Sent} />
  </div>;
}

function NoSpotsFallback({ dict }: DictProps) {
  return <article className={SURFACE} data-fallback="D2"><NoSpotsContent dict={dict} /></article>;
}

function apologyCopy(state: "D5" | "D6", dict: ChatDict) {
  const copy = dict.errorStates;
  if (state === "D5") return { message: copy.d5Message, hint: copy.d5Hint, retry: copy.d5Retry };
  return { message: copy.d6Message, hint: copy.d6Hint, retry: copy.d6Retry };
}

function ApologyFallback({ state, dict }: Readonly<{ state: "D5" | "D6"; dict: ChatDict }>) {
  const actions = useChatActions(), copy = apologyCopy(state, dict);
  return <article className={SURFACE} data-fallback={state}>
    <div role="alert"><FallbackMessage kind={state === "D5" ? "clock" : "reply"} title={copy.message} hint={copy.hint} /></div>
    <Button htmlType="button" type="default" className={RETRY} disabled={actions.disabled} onClick={actions.regenerate} icon={<ProgressGlyph kind="retried" />}>{copy.retry}</Button>
  </article>;
}

/** Settled failures expose dictionary copy only, never wire error details. */
export function EnvelopeFallback({ state, dict }: Props) {
  if (state === "D1") return <RecognitionFallback dict={dict} />;
  if (state === "D2") return <NoSpotsFallback dict={dict} />;
  return <ApologyFallback state={state === "D5" ? "D5" : "D6"} dict={dict} />;
}
