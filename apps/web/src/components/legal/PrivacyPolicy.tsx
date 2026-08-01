import { useDict } from "../../i18n/context";
import type { Dict } from "../../i18n/dictionaries";
import { LocaleSwitcher } from "../../i18n/LocaleSwitcher";

type PrivacyCopy = Dict["privacy"];

interface SectionProps {
  readonly heading: string;
  readonly body: string;
}

function PrivacySection({ heading, body }: SectionProps) {
  return <section className="privacy-page__section"><h2>{heading}</h2><p>{body}</p></section>;
}

function PrivacySections({ copy }: { copy: PrivacyCopy }) {
  return <div className="privacy-page__sections">
    <PrivacySection heading={copy.account_heading} body={copy.account_body} />
    <PrivacySection heading={copy.product_heading} body={copy.product_body} />
    <PrivacySection heading={copy.browser_heading} body={copy.browser_body} />
    <PrivacySection heading={copy.sharing_heading} body={copy.sharing_body} />
    <PrivacySection heading={copy.choices_heading} body={copy.choices_body} />
  </div>;
}

function PrivacyContact({ copy }: { copy: PrivacyCopy }) {
  return <aside className="privacy-page__contact"><p>{copy.contact}</p><a href="https://github.com/lifeodyssey/animichi/issues" target="_blank" rel="noreferrer">{copy.contact_link}</a></aside>;
}

/** Current data practices for the rebuilt web app, rendered in the active locale. */
export function PrivacyPolicy() {
  const copy = useDict().privacy;
  return <main className="privacy-page" aria-labelledby="privacy-title">
    <div className="privacy-page__nav"><a className="privacy-page__back" href="/">← {copy.back_home}</a><LocaleSwitcher /></div>
    <header className="privacy-page__header"><p className="eyebrow">Animichi</p><h1 id="privacy-title">{copy.title}</h1><p className="privacy-page__updated">{copy.updated}</p><p className="privacy-page__intro">{copy.intro}</p></header>
    <PrivacySections copy={copy} />
    <PrivacyContact copy={copy} />
  </main>;
}
