import type { Mood } from "../mood";

/** B2c long-wait card: the title's line over a gradient, with attribution. */
export function MoodCard({ mood }: Readonly<{ mood: Mood | undefined }>) {
  if (!mood) return null;
  return (
    <figure className="chat-mood entrance-up">
      <blockquote className="chat-mood__quote">{mood.quote}</blockquote>
      <figcaption className="chat-mood__source">{mood.source}</figcaption>
    </figure>
  );
}
