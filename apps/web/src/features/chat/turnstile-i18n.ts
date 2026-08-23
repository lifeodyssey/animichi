/** Turnstile challenge copy (issue #281 S1.9): the widget label plus the
 * retryable rejection the edge Worker returns for a bad or expired token. */
export interface ChatTurnstileDict {
  readonly label: string;
  readonly failed: string;
  readonly retry: string;
}

export const jaTurnstile: ChatTurnstileDict = {
  label: "かんたんな確認",
  failed: "確認がうまくいかなかったみたい。もう一度ためしてね",
  retry: "もう一度ためす",
};

export const zhTurnstile: ChatTurnstileDict = {
  label: "简单的验证",
  failed: "验证没通过,再试一次就好",
  retry: "再试一次",
};

export const enTurnstile: ChatTurnstileDict = {
  label: "A quick check",
  failed: "That check didn't go through. Give it another try",
  retry: "Try again",
};
