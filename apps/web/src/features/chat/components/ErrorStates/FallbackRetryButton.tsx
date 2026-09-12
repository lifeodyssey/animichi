import { AnimalButton } from "../AnimalButton";

type Props = Readonly<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}>;

/** Shared Animal Island action button for the D-state fallbacks. Small size:
 * inside a quiet notice strip a full-height button out-shouts the message. */
export function FallbackRetryButton({ label, onClick, disabled, className }: Props) {
  return (
    <AnimalButton size="small" className={className} onClick={onClick} disabled={disabled}>
      {label}
    </AnimalButton>
  );
}
