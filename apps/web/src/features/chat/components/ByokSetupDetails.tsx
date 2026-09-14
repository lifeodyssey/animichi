import { Button } from "animal-island-ui-tailwind/button";
import { useId } from "react";
import { LoginModal } from "../../auth/ui/LoginModal";
import { BYOK_SETUP_TARGET, useLoginDisclosure } from "../byok-journey";
import { chatActionClass } from "./chat-button-classes";
import type { ChatDict } from "../i18n";

type ByokCopy = ChatDict["byok"];
const FACT_ROW = "grid min-w-0 grid-cols-[40px_minmax(0,1fr)] items-start gap-x-3";
const ACTION = chatActionClass({ tone: "paper", className: "chat-byok-upsell__signin [padding:9px_16px]!" });

/** Shared facts keep the discovery and login-required states consistent. */
export function ByokSetupFacts({ byok, costId }: Readonly<{ byok: ByokCopy; costId: string }>) {
  return <dl className="chat-byok-upsell__points grid min-w-0 gap-3">
    <div className={FACT_ROW}><dt className="text-muted-fg">{byok.upsellCostLabel}</dt><dd id={costId}>{byok.upsellCost}</dd></div>
    <div className={FACT_ROW}><dt className="text-muted-fg">{byok.upsellPrivacyLabel}</dt><dd>{byok.upsellPrivacy}</dd></div>
  </dl>;
}

/** Opening login does not authenticate or resend; the callback still leads to key settings. */
export function ByokSetupAction({ byok, describedBy }: Readonly<{ byok: ByokCopy; describedBy: string }>) {
  const login = useLoginDisclosure(), hintId = useId();
  return <div className="grid min-w-0 justify-items-start gap-2">
    <p id={hintId} className="text-xs leading-5 text-muted-fg">{byok.upsellAccount}</p>
    <Button htmlType="button" type="default" className={ACTION} onClick={login.show} aria-describedby={`${describedBy} ${hintId}`} aria-haspopup="dialog">{byok.signInToSetUp}</Button>
    <LoginModal open={login.open} onClose={login.hide} returnTarget={BYOK_SETUP_TARGET} />
  </div>;
}
