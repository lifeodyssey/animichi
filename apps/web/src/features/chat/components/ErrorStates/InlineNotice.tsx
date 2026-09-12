import type { ReactNode } from "react";

/** The notice's intent; the semantic tokens carry the actual colors. */
export type InlineNoticeTone = "retry" | "auth" | "error";

/* Both palettes keep AA without a night flip: `text-fg` and the soft grounds
 * are token pairs that already invert together under `[data-theme="night"]`,
 * and the error pair deliberately stays on its light tint in both themes. */
const TONE: Readonly<Record<InlineNoticeTone, string>> = {
  retry: "border-primary-strong bg-primary-soft text-fg",
  auth: "border-warning-fg bg-gold-soft text-fg",
  error: "border-error-strong bg-error-bg text-error-strong",
};

const GEOMETRY =
  "flex flex-wrap items-center gap-3 rounded-[14px] border-l-4 px-4 py-2.5 text-sm font-medium";

type Props = Readonly<{
  tone: InlineNoticeTone;
  /** `alert` when something failed; `status` when the surface is merely closed. */
  role: "alert" | "status";
  /** Legacy BEM block, kept as an unstyled hook for tests and probes. */
  block: string;
  /** Set when a locked composer points its `aria-describedby` at this notice. */
  id?: string;
  /** Interruption strips name their D-state for the tests that pin recovery. */
  dataState?: string;
  actions?: ReactNode;
  children: ReactNode;
}>;

/**
 * The one inline notice of the chat error family: a left-accented strip whose
 * tone is the only visual difference between an interruption, an auth gate
 * and a failure. The actions slot sits right of the message on wide rows and
 * wraps to a full-width row on narrow ones.
 */
export function InlineNotice({ tone, role, block, id, dataState, actions, children }: Props) {
  return (
    <div id={id} role={role} data-state={dataState} className={`${block} ${GEOMETRY} ${TONE[tone]}`}>
      <span className="min-w-0 flex-1">{children}</span>
      {actions === undefined ? null : <span className="flex gap-2 max-sm:w-full">{actions}</span>}
    </div>
  );
}
