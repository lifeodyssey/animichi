import type { ReactElement } from "react";

interface SparkIconProps {
  readonly className: string;
}

/** Four-point sparkle star (design-sync flourish), coloured via CSS `fill`. */
export function SparkIcon({ className }: SparkIconProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 0c1.2 6.5 4.3 9.6 12 12-7.7 2.4-10.8 5.5-12 12-1.2-6.5-4.3-9.6-12-12 7.7-2.4 10.8-5.5 12-12Z" />
    </svg>
  );
}
