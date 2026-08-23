import { LanguageSelect } from "./LanguageSelect";
import { ThemeSwitch } from "./ThemeSwitch";

/**
 * The app-level preferences the ⚙ panel hosts: day/night and language.
 *
 * Owner 2026-08-23 — why the PANEL and not the app bar, so nobody "optimises"
 * them back up there: by Emil Kowalski's frequency test these are set-once,
 * touch-never controls, while the bar is permanent every-screen real estate
 * whose three slots (torii wordmark · ⊕ new conversation · avatar) are all
 * per-session actions. The retired three-button language switcher is the
 * proof — at 375px it squeezed the brand name off the bar entirely.
 *
 * Composed at the UI layer and handed to chat as a node, so the chat feature
 * never imports app-level preference UI and the dependency direction
 * `routes → components → features` stays one-way. The surrounding panel
 * already carries the region's accessible name, so this is a plain group.
 */
export function AppPreferences() {
  return (
    <div className="app-preferences">
      <ThemeSwitch />
      <LanguageSelect />
    </div>
  );
}
