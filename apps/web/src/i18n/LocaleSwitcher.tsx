import { useLocale, useSetLocale } from "./context";
import { LOCALES, LOCALE_LABELS, type Locale } from "./locales";

interface LocaleOptionProps {
  locale: Locale;
  active: Locale;
  onSelect: (locale: Locale) => void;
}

function LocaleOption({ locale, active, onSelect }: LocaleOptionProps) {
  const select = () => { onSelect(locale); };
  return (
    <button type="button" className="locale-switcher__option" aria-pressed={locale === active} onClick={select}>
      {LOCALE_LABELS[locale]}
    </button>
  );
}

/** Segmented ja/zh/en switcher driven by the i18n context. */
export function LocaleSwitcher() {
  const active = useLocale();
  const setLocale = useSetLocale();
  return (
    <div className="locale-switcher" role="group" aria-label="Language">
      {LOCALES.map((locale) => <LocaleOption key={locale} locale={locale} active={active} onSelect={setLocale} />)}
    </div>
  );
}
