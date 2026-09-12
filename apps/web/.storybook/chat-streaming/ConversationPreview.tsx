import type { ComponentProps, ReactNode } from "react";
import { fn } from "storybook/test";
import { ComposerDock } from "../../src/features/chat/components/ComposerDock";
import { MessageList } from "../../src/features/chat/components/MessageList";

export function ConversationSurface({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="rounded-3xl bg-paper px-5 py-6 sm:px-7 sm:py-8">{children}</div>;
}

const onSend = fn();
export function ConversationPreview(props: ComponentProps<typeof MessageList>) {
  const gate = { locked: false, busy: props.status === "streaming" || props.status === "submitted", failed: false };
  return (
    <div className="grid gap-10">
      <MessageList {...props} />
      <div className="-mx-5 -mb-6 sm:-mx-7 sm:-mb-8"><ComposerDock dict={props.dict} baseUrl="/storybook" photo={{ locale: props.dict.locale }} gate={gate} quotaLocked={false} onSend={onSend} /></div>
    </div>
  );
}
