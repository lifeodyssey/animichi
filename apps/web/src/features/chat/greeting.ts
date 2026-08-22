/** One stretch of the lead bubble's greeting, plain or set in bold. */
export interface GreetingRun {
  readonly text: string;
  readonly emphasised: boolean;
}

function plain(text: string): readonly GreetingRun[] {
  return text === "" ? [] : [{ text, emphasised: false }];
}

/**
 * The greeting cut into runs at the phrases the dictionary marks, in order.
 * The design's welcome bolds two anchors — who is speaking and what the fox
 * accepts — so the copy stays one translatable sentence and the emphasis is
 * declared beside it rather than baked into markup per locale.
 */
export function greetingRuns(text: string, emphasis: readonly string[]): readonly GreetingRun[] {
  const [phrase, ...rest] = emphasis;
  if (phrase === undefined || phrase === "") return plain(text);
  const at = text.indexOf(phrase);
  if (at < 0) return greetingRuns(text, rest);
  const tail = greetingRuns(text.slice(at + phrase.length), rest);
  return [...plain(text.slice(0, at)), { text: phrase, emphasised: true }, ...tail];
}
