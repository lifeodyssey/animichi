import { Button } from "animal-island-ui-tailwind/button";
import { chatButtonClass } from "../chat-button-classes";

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
    <Button htmlType="button" type="primary" size="small" className={chatButtonClass({ size: "small", className })} onClick={onClick} disabled={disabled}>
      {label}
    </Button>
  );
}
