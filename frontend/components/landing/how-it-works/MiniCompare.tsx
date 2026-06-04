/** Anime-vs-real split-photo preview for the "compare" step. */
export default function MiniCompare() {
  return (
    <div className="relative flex h-20 overflow-hidden rounded-[12px] border border-border">
      <img
        src="/images/landing/suga-shrine-anime-source.webp"
        alt=""
        className="h-full w-1/2 object-cover"
      />
      <img
        src="/images/landing/suga-shrine-reality-perspective-v2.webp"
        alt=""
        className="h-full w-1/2 border-l-2 border-background object-cover"
      />
      <span className="absolute left-1.5 top-1.5 rounded-[6px] bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">
        Anime
      </span>
      <span className="absolute right-1.5 top-1.5 rounded-[6px] bg-fg/80 px-1.5 py-0.5 text-[9px] font-bold text-background">
        Real
      </span>
    </div>
  );
}
