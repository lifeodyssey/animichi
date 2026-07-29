import { LoginModal } from "../../../components/auth/LoginModal";
import { BYOK_SETUP_TARGET, useLoginDisclosure } from "../byok-journey";
import type { ChatDict } from "../i18n";

type Props = Readonly<{ dict: ChatDict }>;

/**
 * BYOK value explainer (issue #284 Task 8): shown before any login prompt so
 * the wall reads as a journey. It states what BYOK gives (unmetered use on
 * the user's own provider account), that the key stays in the browser and is
 * never stored on the server, and that an account is required — its primary
 * action opens the magic-link login whose mailed link deep-links back to the
 * open settings panel.
 */
type ByokCopy = ChatDict["byok"];

function UpsellPoints({ byok }: Readonly<{ byok: ByokCopy }>) {
  return (
    <ul className="chat-byok-upsell__points">
      <li>{byok.upsellBenefit}</li>
      <li>{byok.upsellPrivacy}</li>
      <li>{byok.upsellAccount}</li>
    </ul>
  );
}

function UpsellLogin({ byok }: Readonly<{ byok: ByokCopy }>) {
  const login = useLoginDisclosure();
  return (
    <>
      <button type="button" className="chat-byok__signin" onClick={login.show}>{byok.signInToSetUp}</button>
      <LoginModal open={login.open} onClose={login.hide} returnTarget={BYOK_SETUP_TARGET} />
    </>
  );
}

export function ByokUpsell({ dict }: Props) {
  const byok = dict.byok;
  return (
    <section className="chat-byok-upsell" aria-label={byok.upsellTitle}>
      <h3 className="chat-byok-upsell__title">{byok.upsellTitle}</h3>
      <UpsellPoints byok={byok} />
      <UpsellLogin byok={byok} />
    </section>
  );
}
