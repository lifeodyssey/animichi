import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { Button } from "animal-island-ui-tailwind/button";
import { Drawer } from "animal-island-ui-tailwind/drawer";
import { Tooltip } from "animal-island-ui-tailwind/tooltip";

type Props = Readonly<{
  readonly open: boolean;
  readonly label: string;
  readonly onToggle: () => void;
  readonly onClose: () => void;
  readonly children: ReactNode;
}>;

type TriggerProps = Pick<Props, "label" | "open" | "onToggle"> & Readonly<{ triggerRef: RefObject<HTMLButtonElement | null> }>;

function SettingsTrigger({ label, open, onToggle, triggerRef }: TriggerProps) {
  return (
    <Tooltip title={label} placement="bottom" trigger="focus" variant="island">
      <Button ref={triggerRef} className="chat-appbar__settings" htmlType="button" aria-label={label} aria-expanded={open} aria-controls="byok-settings-panel" onClick={onToggle}>{label}</Button>
    </Tooltip>
  );
}

function SettingsPanel({ open, label, onClose, children }: Omit<Props, "onToggle">) {
  if (!open) return null;
  return (
    <Drawer open={open} title={label} placement="right" width="min(92vw, 28rem)" footer={null} pushBackground={false} className="chat-settings-drawer" onClose={onClose}>
      {children}
    </Drawer>
  );
}

/** Header-owned settings affordance with a full-viewport, focus-trapped panel. */
export function ChatSettingsDrawer(props: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(props.open);
  useEffect(() => {
    if (wasOpen.current && !props.open) triggerRef.current?.focus();
    wasOpen.current = props.open;
  }, [props.open]);
  return <><SettingsTrigger label={props.label} open={props.open} onToggle={props.onToggle} triggerRef={triggerRef} /><SettingsPanel open={props.open} label={props.label} onClose={props.onClose}>{props.children}</SettingsPanel></>;
}
