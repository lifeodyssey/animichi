/** A B2c mood card: a title's line + attribution shown during a long wait. */
export interface Mood {
  readonly quote: string;
  readonly source: string;
}

type MoodEntry = Mood & { readonly keyword: string };

const MOODS: readonly MoodEntry[] = [
  { keyword: "ユーフォ", quote: "ここから、はじまるんだ。", source: "— 響け!ユーフォニアム" },
  { keyword: "君の名", quote: "君の、名前は——", source: "— 君の名は。" },
];

/** Match the pending user text to a known title; undefined skips the card. */
export function pickMood(text: string): Mood | undefined {
  const entry = MOODS.find((mood) => text.includes(mood.keyword));
  return entry ? { quote: entry.quote, source: entry.source } : undefined;
}
