import { Button } from "animal-island-ui-tailwind/button";
import { useId } from "react";
import type { ChatErrorStatesDict } from "../../error-states-i18n";
import type { ChatDict } from "../../i18n";

export type InterruptionShape = "D4" | "D5" | "D10" | "D15" | "D16" | "D17" | "D18";

type Props = Readonly<{
  state: InterruptionShape;
  dict: ChatDict;
  onRetry: () => void;
  recovering?: boolean;
  /** D18 only: the error code named by the honest-generic copy. */
  errorCode?: string;
}>;

interface InterruptionCopy { message: string; hint: string; retry: string }

const COPY: Readonly<Record<InterruptionShape, (states: ChatErrorStatesDict) => InterruptionCopy>> = {
  D4: (s) => ({ message: s.d4Message, hint: s.d4Hint, retry: s.d4Retry }),
  D5: (s) => ({ message: s.d5Message, hint: s.d5Hint, retry: s.d5Retry }),
  D10: (s) => ({ message: s.d10Message, hint: s.d10Hint, retry: s.d10Retry }),
  D15: (s) => ({ message: s.d15Message, hint: s.d15Hint, retry: s.d15Retry }),
  D16: (s) => ({ message: s.d16Message, hint: s.d16Hint, retry: s.d16Retry }),
  D17: (s) => ({ message: s.d17Message, hint: s.d17Hint, retry: s.d17Retry }),
  D18: (s) => ({ message: s.d18Title, hint: s.d18Hint, retry: s.d18Retry }),
};

const ACTION = "chat-interruption__retry [min-height:44px]! [height:auto]! [padding:9px_14px]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! [--animal-text-color:var(--color-primary-strong)] [--animal-bg-color:var(--color-paper)] focus-visible:outline-primary-strong motion-reduce:transition-none";
const DETAIL_TRIGGER = "w-fit max-w-full cursor-pointer rounded-md py-2.5 text-sm leading-6 text-muted-fg underline-offset-4 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong";

function InterruptionMark({ busy, failed }: Readonly<{ busy: boolean; failed: boolean }>) {
  const tone = failed && !busy ? "bg-error-bg text-error-strong" : "bg-primary-soft text-primary-strong";
  return <span aria-hidden="true" className={`mt-0.5 [display:grid] size-7 shrink-0 place-items-center rounded-full ${tone}`}>
    {busy ? <span className="size-3.5 rounded-full border-2 border-primary/25 border-t-primary-strong motion-safe:animate-spin motion-safe:[animation-duration:1.4s] motion-reduce:animate-none" /> : <svg className="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d={failed ? "M10 5v6m0 4h.01" : "M7 6v8m6-8v8"} /></svg>}
  </span>;
}

function ErrorDetails({ dict, errorCode }: Pick<Props, "dict" | "errorCode">) {
  const copy = dict.errorStates;
  return <details className="col-start-2 min-w-0" key={errorCode ?? "unknown"}>
    <summary className={DETAIL_TRIGGER}>{copy.interruptionDetails}</summary>
    <p className="mt-1 rounded-lg bg-error-bg px-3 py-2 text-xs leading-5 text-error-strong [overflow-wrap:anywhere]">{copy.d18Message.replace("{code}", errorCode ?? "unknown")}</p>
  </details>;
}

/**
 * Recovery is supplied by the caller; a retry click never fabricates progress.
 * aria-disabled and a click guard preserve focus while preventing repeated work.
 * Existing content and per-state resend/read-latest behavior remain with the caller.
 */
export function StreamInterruption({ state, dict, onRetry, recovering = false, errorCode }: Props) {
  const copy = COPY[state](dict.errorStates), descriptionId = useId();
  return <div className="chat-interruption grid min-w-0 grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-1 text-sm leading-6 text-fg" role={recovering ? "status" : "alert"} aria-atomic="true" data-state={state}>
    <InterruptionMark busy={recovering} failed={state === "D17" || state === "D18"} />
    <div id={descriptionId} className="grid min-w-0 gap-1 [overflow-wrap:anywhere]"><p className="font-semibold">{recovering ? dict.errorStates.interruptionRecovering : copy.message}</p><p className="text-muted-fg">{recovering ? dict.errorStates.interruptionRecoveringHint : copy.hint}</p></div>
    <div className="col-start-2 min-w-0"><Button htmlType="button" type="default" className={`${ACTION} ${recovering ? "animal-btn-disabled [pointer-events:none]" : ""}`} onClick={() => { if (!recovering) onRetry(); }} aria-disabled={recovering} aria-busy={recovering} aria-describedby={descriptionId}>{copy.retry}</Button></div>
    {state === "D18" ? <ErrorDetails dict={dict} errorCode={errorCode} /> : null}
  </div>;
}
