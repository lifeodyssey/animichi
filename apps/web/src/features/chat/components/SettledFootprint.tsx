import type { ReactNode } from "react";
import type { ChatDict } from "../i18n";

type Props = Readonly<{ elapsedLabel?: string; dict: ChatDict; children: ReactNode }>;

function FootprintSummary({ elapsedLabel, dict }: Readonly<{ elapsedLabel?: string; dict: ChatDict }>) {
  return (
    <summary className="chat-settled__summary">
      ✓{elapsedLabel ? <span className="chat-settled__elapsed"> {elapsedLabel}</span> : null} ·{" "}
      {dict.footprintDetails} ▾
    </summary>
  );
}

/** B4: a settled turn's pipeline collapses into one expandable footprint row. */
export function SettledFootprint({ elapsedLabel, dict, children }: Props) {
  return (
    <details className="chat-settled">
      <FootprintSummary elapsedLabel={elapsedLabel} dict={dict} />
      {children}
    </details>
  );
}
