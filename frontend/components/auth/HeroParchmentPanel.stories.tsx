import type { Meta, StoryObj } from "@storybook/react";
import HeroParchmentPanel from "./HeroParchmentPanel";

const meta = {
  title: "Landing/Hero/ParchmentPanel",
  component: HeroParchmentPanel,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Left hero panel — a journal page with serif headline, turned corner, leaf, and pressed stamps. Shown over the real-scene backdrop it floats on.",
      },
    },
  },
} satisfies Meta<typeof HeroParchmentPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const onScene = (children: React.ReactNode) => (
  <div
    className="min-h-[460px] bg-cover bg-center p-12 font-sans"
    style={{
      backgroundImage:
        "url(/images/landing/suga-shrine-reality-perspective-v2.webp)",
    }}
  >
    {children}
  </div>
);

export const English: Story = {
  args: {
    headline: "Turn anime scenes\ninto today's walking route",
    lead: "Find real locations, compare the scene, and plan a route you can actually walk.",
    authHint: "Log in only when you want to save or sync.",
  },
  render: (args) => onScene(<HeroParchmentPanel {...args} />),
};

export const Japanese: Story = {
  args: {
    headline: "アニメのあの場所を、\n今日の徒歩ルートに。",
    lead: "聖地を探して、シーンと見比べて、実際に歩けるルートを組み立てる。",
    authHint: "保存・同期したいときだけログイン。",
  },
  render: (args) => onScene(<HeroParchmentPanel {...args} />),
};
