import type { Meta, StoryObj } from "@storybook/react";
import Stamp from "./Stamp";
import RouteLine from "./RouteLine";
import LeafSprig from "./LeafSprig";
import PaperCard from "./PaperCard";
import LocationBadge from "./LocationBadge";
import TicketStub from "./TicketStub";

const meta = {
  title: "Landing/Decor primitives",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Shared travel-journal motifs that compose every homepage section: rubber stamps, dashed route lines, leaf sprigs, parchment cards, place tags, ticket stubs, and the pumpkin-orange Explore CTA.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border/60 px-8 py-7">
      <p className="mb-5 text-[12px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-wrap items-center gap-8">{children}</div>
    </section>
  );
}

export const All: Story = {
  name: "All primitives",
  render: () => (
    <div className="bg-background font-sans text-fg">
      <Panel title="Stamp — postmark seals">
        <Stamp ringText="聖地巡礼" glyph="torii" />
        <Stamp ringText="次の一歩" glyph="footprint" rotate={6} />
        <Stamp glyph="compass" size={64} rotate={-4} />
        <Stamp glyph="star" size={64} rotate={10} />
      </Panel>

      <Panel title="Route line — teal start → coral destination">
        <div className="w-[420px]">
          <RouteLine />
        </div>
        <div className="w-[420px]">
          <RouteLine stops={2} />
        </div>
      </Panel>

      <Panel title="Leaf sprig">
        <LeafSprig size={40} />
        <LeafSprig size={40} flip />
        <LeafSprig size={28} />
      </Panel>

      <Panel title="Paper card — folded corner + tilt">
        <PaperCard rotate={-1.5} className="w-[300px] px-6 py-5">
          <h3 className="font-display text-[20px] font-bold text-fg-heading">
            須賀神社 階段巡礼
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            A page torn from the journal: grain, a turned corner, a hand tilt.
          </p>
        </PaperCard>
        <PaperCard fold={false} rotate={2} className="w-[220px] px-5 py-4">
          <p className="text-[13px] text-fg">Flat variant, no fold.</p>
        </PaperCard>
      </Panel>

      <Panel title="Location badge + ticket stub">
        <LocationBadge name="新宿" />
        <LocationBadge name="宇治 · 京都" />
        <TicketStub label="聖地巡礼きっぷ" sub="2025.05.18 · TYO" />
        <TicketStub label="Let's go!" rotate={4} />
      </Panel>

      <Panel title="Explore CTA — pumpkin orange, 3D depth">
        <button className="btn-explore flex items-center gap-2 px-7 py-3 text-[15px] font-bold">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l2.4 6.9H21l-5.3 4 2 6.6L12 15.8 6.3 19.5l2-6.6L3 8.9h6.6z" />
          </svg>
          Start Exploring
        </button>
        <button className="btn-explore px-7 py-3 text-[15px] font-bold" disabled>
          Disabled
        </button>
      </Panel>
    </div>
  ),
};
