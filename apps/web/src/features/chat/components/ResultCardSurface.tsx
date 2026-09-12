import type { ReactNode } from "react";

type Props = Readonly<{ children: ReactNode; superseded?: boolean; intent: string }>;

/** Non-interactive cards stay still, keeping nested fixed dialogs viewport-bound. */
const SURFACE = "animal-card grid w-full max-w-xl gap-5 data-[intent=clarify]:gap-3 [cursor:default] [transform:none]! [padding:20px] sm:[padding:24px] [--animal-bg-color-content:var(--color-paper)] [--animal-text-color-body:var(--color-fg)] motion-reduce:transition-none";

export function ResultCardSurface({ children, superseded, intent }: Props) {
  const classes = superseded ? `${SURFACE} chat-card--superseded` : SURFACE;
  return <article className={classes} data-intent={intent}>{children}</article>;
}
