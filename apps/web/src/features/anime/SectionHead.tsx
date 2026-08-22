type Props = Readonly<{ id: string; label: string }>;

/**
 * The canvas's `.sechead` (作品公開页 demo.html): a section's heading sits on
 * the page floor ABOVE its card, not inside it — so the card stays a clean
 * clipped surface and the heading reads as the divider between blocks.
 */
export function SectionHead({ id, label }: Props) {
  return (
    <div className="anime-sechead">
      <h2 id={id} className="anime-sechead__label">{label}</h2>
    </div>
  );
}
