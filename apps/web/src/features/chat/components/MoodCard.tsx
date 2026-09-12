import type { Mood } from "../mood";

/** B2c long-wait aside: keep the attributed quote quieter than the response. */
export function MoodCard({ mood }: Readonly<{ mood: Mood | undefined }>) {
  if (!mood) return null;
  return (
    <figure className="m-0 ml-[52px] grid max-w-md gap-1 rounded-2xl bg-card px-4 py-3 text-fg">
      <blockquote className="m-0 text-base leading-7">{mood.quote}</blockquote>
      <figcaption className="text-sm leading-6 text-muted-fg">{mood.source}</figcaption>
    </figure>
  );
}
