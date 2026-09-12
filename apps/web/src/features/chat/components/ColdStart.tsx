import { Button } from "animal-island-ui-tailwind/button";
import { useId } from "react";
import type { ChatDict } from "../i18n";

type Props = Readonly<{ dict: ChatDict; onChip: (text: string) => void; disabled?: boolean }>;
type Example = Readonly<{ label: string; prompt: string; primary?: boolean }>;
const ACTION = "[display:flex]! w-full [min-height:44px]! [height:auto]! [white-space:normal]! [text-align:left]! [padding:14px_18px]! [font-size:15px]! [line-height:1.6]! [&>span]:w-full focus-visible:outline-primary-strong focus-visible:outline-offset-4 motion-reduce:[transition:none]!";
const FEATURED = "[--animal-bg-color:var(--color-primary-soft)] [--animal-text-color:var(--color-primary-strong)] [--animal-border-color:var(--color-primary-strong)]";
const QUIET = "[--animal-text-color:var(--color-fg)] [--animal-bg-color-secondary:var(--color-muted)]";

function SendArrow() {
  return <svg aria-hidden="true" className="size-[18px] shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M4 10h12m-5-5 5 5-5 5" /></svg>;
}

/** The question on the button is the exact message sent; the label only gives context. */
function ExampleButton({ example, disabled, onChip }: Readonly<{ example: Example; disabled: boolean; onChip: Props["onChip"] }>) {
  const id = useId();
  return <Button htmlType="button" type={example.primary ? "default" : "text"} className={ACTION + " " + (example.primary ? FEATURED : QUIET)} disabled={disabled} aria-labelledby={id + "-prompt"} aria-describedby={id + "-label"} onClick={() => { onChip(example.prompt); }}>
    <span className="[display:grid] grid-cols-[minmax(0,1fr)_18px] items-center gap-4"><span className="[display:grid] min-w-0 gap-1"><span id={id + "-label"} className="text-xs font-medium">{example.label}</span><span id={id + "-prompt"} className="font-semibold [overflow-wrap:anywhere]">{example.prompt}</span></span><SendArrow /></span>
  </Button>;
}

function StartExamples({ dict, onChip, disabled = false }: Props) {
  const examples: readonly Example[] = [{ label: dict.entryAnimeTitle, prompt: dict.entryAnimePrompt, primary: true }, { label: dict.entryCityTitle, prompt: dict.entryCityPrompt }];
  return <div className="grid gap-3">
    {examples.map(example => <ExampleButton key={example.label} example={example} disabled={disabled} onChip={onChip} />)}
    <Button htmlType="button" type="text" className={ACTION + " " + QUIET + " [font-size:14px]!"} disabled={disabled} onClick={() => { onChip(dict.entryChatPrompt); }}>{dict.entryChatPrompt}</Button>
  </div>;
}

/** An invitation and concrete examples; selecting one delegates to the existing send path. */
export function ColdStart({ dict, onChip, disabled = false }: Props) {
  const headingId = useId(), examplesId = useId();
  return <section className="mx-auto grid w-full min-w-0 max-w-[560px] flex-1 content-center gap-7 px-4 py-6 text-left text-fg" aria-labelledby={headingId}>
    <div className="grid gap-3"><h1 id={headingId} className="m-0 max-w-[24ch] text-balance text-[clamp(26px,3vw,34px)] font-bold leading-[1.3]">{dict.coldStartHeading}</h1><p className="m-0 max-w-[48ch] text-balance text-[15px] leading-7 text-muted-fg">{dict.coldStartSub}</p></div>
    <div className="grid gap-3" role="group" aria-labelledby={examplesId}><p id={examplesId} className="m-0 px-1 text-xs font-medium text-muted-fg">{dict.coldStartExamples}</p><StartExamples dict={dict} onChip={onChip} disabled={disabled} /></div>
  </section>;
}
