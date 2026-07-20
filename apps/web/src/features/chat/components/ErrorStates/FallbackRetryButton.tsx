type Props = Readonly<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className: string;
}>;

/** Shared press-style action button for the D-state fallbacks. */
export function FallbackRetryButton({ label, onClick, disabled, className }: Props) {
  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
