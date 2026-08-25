import { LanguageSelect } from "./LanguageSelect";
import { ThemeSwitch } from "./ThemeSwitch";

/**
 * App-level preferences on the dedicated settings page: day/night and language.
 *
 * These are set-once controls, so the chat bar links to them instead of
 * carrying them on every screen. The page owns the copy and layout while the
 * controls keep their existing storage adapters as the single state owners.
 */
export function AppPreferences() {
  return (
    <div className="app-preferences" role="group">
      <ThemeSwitch />
      <LanguageSelect />
    </div>
  );
}
