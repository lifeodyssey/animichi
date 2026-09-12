/** Turnstile challenge copy (issue #281 S1.9): the widget label plus the
 * retryable rejection the edge Worker returns for a bad or expired token. */
export interface ChatTurnstileDict {
  readonly label: string;
  readonly failed: string;
  readonly retry: string;
  readonly checkingTitle: string;
  readonly checkingHint: string;
  readonly interactiveTitle: string;
  readonly interactiveHint: string;
  readonly verifyingTitle: string;
  readonly verifyingHint: string;
  readonly failedTitle: string;
}

export const jaTurnstile: ChatTurnstileDict = {
  label: "かんたんな確認",
  failed: "確認を完了できなかったよ。もう一度ためしてね。",
  retry: "もう一度ためす",
  checkingTitle: "アクセスを確認中",
  checkingHint: "通常は自動で進むよ。操作が必要なときは、下の案内に従ってね。",
  interactiveTitle: "下の確認をお願い",
  interactiveHint: "画面の案内に沿って操作してね。",
  verifyingTitle: "確認結果を待っているよ",
  verifyingHint: "確認が終わると、会話に進むよ。",
  failedTitle: "確認を完了できなかった",
};

export const zhTurnstile: ChatTurnstileDict = {
  label: "简单的验证",
  failed: "本次验证未能完成，可以再试一次。",
  retry: "再试一次",
  checkingTitle: "正在确认访问",
  checkingHint: "通常会自动完成。如需操作，请按下方提示继续。",
  interactiveTitle: "请完成下方验证",
  interactiveHint: "按照验证框内的提示操作即可。",
  verifyingTitle: "正在确认验证结果",
  verifyingHint: "确认完成后，会继续进入对话。",
  failedTitle: "这次验证没有完成",
};

export const enTurnstile: ChatTurnstileDict = {
  label: "A quick check",
  failed: "That check didn't go through. Give it another try",
  retry: "Try again",
  checkingTitle: "Checking your access",
  checkingHint: "This usually completes automatically. Follow the prompt below if an action is needed.",
  interactiveTitle: "Complete the check below",
  interactiveHint: "Follow the instructions in the verification box.",
  verifyingTitle: "Confirming the result",
  verifyingHint: "The conversation will open once the result is confirmed.",
  failedTitle: "The check didn't complete",
};
