import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import { ComingSoonPopup } from "./ComingSoonPopup";

/** Pins navigator.languages for the story's lifetime, restoring the original descriptor on unmount. */
function LocalePin({ langs, children }: { langs: string[]; children: ReactNode }): ReactElement {
  useEffect(() => {
    const original = Object.getOwnPropertyDescriptor(navigator, "languages");
    Object.defineProperty(navigator, "languages", { value: langs, configurable: true });
    return () => {
      if (original) Object.defineProperty(navigator, "languages", original);
    };
  }, [langs]);
  return <>{children}</>;
}

function withLanguages(langs: string[]): Decorator {
  return (Story) => <LocalePin langs={langs}><Story /></LocalePin>;
}

const meta = { title: "Landing/ComingSoonPopup", component: ComingSoonPopup, parameters: { layout: "centered" } } satisfies Meta<typeof ComingSoonPopup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Japanese: Story = {
  args: { open: true, onClose: fn() },
  decorators: [withLanguages(["ja-JP"])],
};

export const Chinese: Story = {
  args: { open: true, onClose: fn() },
  decorators: [withLanguages(["zh-CN"])],
};

export const English: Story = {
  args: { open: true, onClose: fn() },
  decorators: [withLanguages(["en-US"])],
};
