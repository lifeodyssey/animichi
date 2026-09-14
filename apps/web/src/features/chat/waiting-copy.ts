import type { Locale } from "../../i18n/locales";

interface WaitingCopy {
  readonly label: string;
  readonly extended: string;
}

const COPY: Readonly<Record<Locale, WaitingCopy>> = {
  zh: { label: "正在等待回复…", extended: "这次等待有点久，请再稍等一下。" },
  en: { label: "Waiting for a reply…", extended: "This is taking a little longer. Please hang on." },
  ja: { label: "返答を待っています…", extended: "少し時間がかかっています。もう少しお待ちください。" },
};

export function waitingCopy(locale: Locale): WaitingCopy {
  return COPY[locale];
}
