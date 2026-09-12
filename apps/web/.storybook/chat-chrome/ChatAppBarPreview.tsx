import type { ComponentProps } from "react";
import { ChatAppBar } from "../../src/features/chat/components/ChatAppBar";
import { chatDictFor, type ChatDict } from "../../src/features/chat/i18n";
import { isLocale } from "../../src/i18n/locales";

export function appBarPreviewDict(locale: unknown): ChatDict {
  return chatDictFor(typeof locale === "string" && isLocale(locale) ? locale : "zh");
}

/** Isolate the mobile bar for desktop review without changing its production breakpoint. */
export function ChatAppBarPreview(props: ComponentProps<typeof ChatAppBar>) {
  return <div className="w-[min(420px,calc(100vw_-_32px))] max-w-full [&>.chat-appbar]:[display:flex]!"><ChatAppBar {...props} /></div>;
}
