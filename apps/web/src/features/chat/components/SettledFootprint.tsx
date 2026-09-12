import { Button } from "animal-island-ui-tailwind/button";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import type { ChatDict } from "../i18n";
import { ProgressGlyph } from "./ProgressGlyph";

type Props = Readonly<{ elapsedLabel?: string; dict: ChatDict; children: ReactNode }>;

const TRIGGER_CLASS = "chat-settled__summary group/footprint [min-height:44px] [padding:0_8px] [font-size:14px] [font-weight:500] [color:var(--color-ground-ink)] [--animal-text-color:var(--color-ground-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong motion-reduce:transition-none";

function FootprintLabel({ elapsedLabel, dict }: Readonly<{ elapsedLabel?: string; dict: ChatDict }>) {
  return (
    <span className="[display:flex] items-center gap-2">
      <ProgressGlyph kind="details" /><span>{dict.footprintDetails}</span>
      {elapsedLabel ? <span className="chat-settled__elapsed tabular-nums">{elapsedLabel}</span> : null}
      <span className="transition-transform duration-200 group-aria-expanded/footprint:rotate-180 motion-reduce:transition-none"><ProgressGlyph kind="chevron" /></span>
    </span>
  );
}

/** B4: a settled turn's pipeline collapses into one expandable footprint row. */
export function SettledFootprint({ elapsedLabel, dict, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return (
    <div className="chat-settled -ml-2 max-w-full text-sm text-ground-ink">
      <Button type="text" className={TRIGGER_CLASS} aria-expanded={expanded} aria-controls={contentId} onClick={() => { setExpanded(!expanded); }}><FootprintLabel elapsedLabel={elapsedLabel} dict={dict} /></Button>
      <div id={contentId} hidden={!expanded}><div className="grid gap-1 border-l border-ground-ink/25 pb-1 pl-4 ml-4">{children}</div></div>
    </div>
  );
}
