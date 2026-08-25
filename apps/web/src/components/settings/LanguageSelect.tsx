import { Select } from "animal-island-ui-tailwind/select";
import type { SelectOption } from "animal-island-ui-tailwind/select";
import { useDict, useLocale, useSetLocale } from "../../i18n/LocaleProvider";
import { isLocale, LOCALES, LOCALE_LABELS } from "../../i18n/locales";
import { SettingsControlCopy } from "./SettingsControlCopy";

/**
 * UI language, as the shared Animal Island `Select` on the settings page.
 *
 * It replaces the retired three-button segmented switcher: three always-visible
 * options cost a whole row, and that row is what pushed the brand off the
 * 375px bar. A dropdown costs one trigger and pays the width back.
 */
const LANGUAGE_OPTIONS: readonly SelectOption[] = LOCALES.map((locale) => ({
  key: locale,
  label: LOCALE_LABELS[locale],
}));

export function LanguageSelect() {
  const setLocale = useSetLocale();
  const settings = useDict().settings;
  const choose = (value: string) => { if (isLocale(value)) setLocale(value); };
  return <div className="settings-control-row">
    <SettingsControlCopy id="settings-language" label={settings.language} description={settings.languageDescription} />
    <Select id="settings-language" aria-labelledby="settings-language-label" aria-describedby="settings-language-description" value={useLocale()} options={[...LANGUAGE_OPTIONS]} onChange={choose} />
  </div>;
}
