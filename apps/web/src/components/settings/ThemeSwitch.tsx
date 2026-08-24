import { Switch } from "../ds/Switch";
import { useTheme } from "../../features/config/use-theme";
import { useDict } from "../../i18n/LocaleProvider";

/**
 * Day/night, as a DS `Switch` inside the settings drawer.
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
  return (
    <Switch
      label={useDict().settings.nightMode}
      checked={theme === "night"}
      onChange={(night) => { set(night ? "night" : "day"); }}
    />
  );
}
