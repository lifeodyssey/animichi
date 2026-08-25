import { Switch } from "animal-island-ui-tailwind/switch";
import { useTheme } from "../../features/config/use-theme";
import { useDict } from "../../i18n/LocaleProvider";
import { SettingsControlCopy } from "./SettingsControlCopy";

/**
 * Day/night, using the shared Animal Island `Switch` on the settings page.
 *
 * ON = night, not day. Two reasons, in this order: the app's default — the SSR
 * render, the stored-nothing case and the bootstrap script's fallback — is day,
 * and a switch's OFF position must be the default state; and the label reads
 * "night mode", so ON means "that mode is on", which is what the DS's green ON
 * track already says. Day would invert both.
 *
 * The label is a fixed noun, never the mode in force: renaming a control when
 * its value changes makes it a different control to a screen reader (WCAG
 * 4.1.2). State travels on `aria-checked` and on the handle's position, so it
 * is never carried by the green alone.
 */
export function ThemeSwitch() {
  const { theme, set } = useTheme();
  const settings = useDict().settings;
  const change = (night: boolean) => { set(night ? "night" : "day"); };
  return <div className="settings-control-row">
    <SettingsControlCopy id="settings-theme" label={settings.nightMode} description={settings.nightModeDescription} />
    <Switch checked={theme === "night"} aria-labelledby="settings-theme-label" aria-describedby="settings-theme-description" onChange={change} />
  </div>;
}
