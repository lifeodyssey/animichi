import { Select, type SelectOption } from "../ds/Select";
import { useDict, useLocale, useSetLocale } from "../../i18n/LocaleProvider";
import { isLocale, LOCALES, LOCALE_LABELS } from "../../i18n/locales";

/**
 * UI language, as the DS's yellow `Select` inside the settings drawer.
 *
 * It replaces the retired three-button segmented switcher: three always-visible
 * options cost a whole row, and that row is what pushed the brand off the
 * 375px bar. A dropdown costs one trigger and pays the width back.
 */
const LANGUAGE_OPTIONS: readonly SelectOption[] = LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_LABELS[locale],
}));

export function LanguageSelect() {
  const setLocale = useSetLocale();
  const choose = (value: string) => { if (isLocale(value)) setLocale(value); };
  return (
    <Select
      id="settings-language" label={useDict().settings.language}
      value={useLocale()} options={LANGUAGE_OPTIONS} onChange={choose}
    />
  );
}
