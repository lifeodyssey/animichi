import { lazy, Suspense, useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { Button } from "animal-island-ui-tailwind/button";

const loadDrawer = () => import("animal-island-ui-tailwind/drawer");
const Drawer = lazy(async () => ({ default: (await loadDrawer()).Drawer }));

function preloadDrawer(): void {
  void loadDrawer();
}

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
    <Button ref={triggerRef} className="chat-appbar__settings" htmlType="button" aria-label={label} aria-expanded={open} aria-controls="byok-settings-panel" onPointerEnter={preloadDrawer} onFocus={preloadDrawer} onClick={onToggle}>{label}</Button>
  );
}

function SettingsPanel({ open, label, onClose, children }: Omit<Props, "onToggle">) {
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <Drawer open={open} title={label} placement="right" width="min(92vw, 28rem)" footer={null} pushBackground={false} className="chat-settings-drawer" onClose={onClose}>
        {children}
      </Drawer>
    </Suspense>
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
