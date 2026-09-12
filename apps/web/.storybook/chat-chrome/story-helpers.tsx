import type { Decorator } from "@storybook/react-vite";
import { useLocale } from "../../src/i18n/LocaleProvider";
import { chatDictFor } from "../../src/features/chat/i18n";

export const withChatLocale: Decorator = function WithChatLocale(Story, context) {
  const dict = chatDictFor(useLocale());
  return <Story args={{ ...context.args, dict }} />;
};

export const chatPanel = (children: React.ReactNode) => (
  <div className="rounded-3xl border-[3px] border-ground-ink bg-paper p-6 shadow-[var(--shadow-press-lg)]">{children}</div>
);
