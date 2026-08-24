import type { ReactNode } from "react";
import type { AuthStatus } from "../../lib/auth/session";
import type { ChatDict } from "../../features/chat/i18n";
import { ByokSettings } from "../../features/chat/components/ByokSettings";
import { useDict } from "../../i18n/LocaleProvider";
import { AppPreferences } from "./AppPreferences";

type Props = Readonly<{
  auth: AuthStatus;
  baseUrl: string;
  chat: ChatDict;
}>;

function SettingsHeader() {
  const settings = useDict().settings;
  return (
    <header className="settings-page__header">
      <a className="settings-page__back" href="/chat"><span aria-hidden="true">←</span>{settings.backToChat}</a>
      <h1>{settings.title}</h1>
      <p>{settings.description}</p>
    </header>
  );
}

function SettingsNav() {
  const settings = useDict().settings;
  return (
    <nav className="settings-page__nav" aria-label={settings.sectionsLabel}>
      <a href="#preferences">{settings.preferencesTitle}</a>
      <a href="#api-key">{settings.apiKeyTitle}</a>
    </nav>
  );
}

type SectionProps = Readonly<{
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}>;

function SettingsSection({ id, title, description, children }: SectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} className="settings-section" aria-labelledby={headingId}>
      <div className="settings-section__intro"><h2 id={headingId}>{title}</h2><p>{description}</p></div>
      {children}
    </section>
  );
}

function PreferencesSection() {
  const settings = useDict().settings;
  return <SettingsSection id="preferences" title={settings.preferencesTitle} description={settings.preferencesDescription}><AppPreferences /></SettingsSection>;
}

function ApiKeySection({ auth, baseUrl, chat }: Props) {
  const settings = useDict().settings;
  return <SettingsSection id="api-key" title={settings.apiKeyTitle} description={settings.apiKeyDescription}><ByokSettings dict={chat} auth={auth} baseUrl={baseUrl} /></SettingsSection>;
}

function SettingsContent(props: Props) {
  return (
    <div className="settings-page__layout">
      <SettingsNav />
      <div className="settings-page__content"><PreferencesSection /><ApiKeySection {...props} /></div>
    </div>
  );
}

/** Dedicated, URL-addressable settings surface; never a modal or drawer. */
export function SettingsPage(props: Props) {
  return <main className="settings-page"><SettingsHeader /><SettingsContent {...props} /></main>;
}
