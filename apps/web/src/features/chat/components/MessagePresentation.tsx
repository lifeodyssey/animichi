import type { ReactNode } from "react";

export const MESSAGE_LIST_CLASS = "mx-auto [display:flex] w-full min-w-0 max-w-[860px] list-none flex-col gap-5 p-0 sm:gap-6";
const TEXT_CLASS = "chat-bubble m-0 max-w-[65ch] whitespace-pre-wrap text-base font-normal leading-7 text-ground-ink [overflow-wrap:anywhere] selection:bg-primary-soft selection:text-primary-ink group-data-[role=user]/message:ml-auto group-data-[role=user]/message:w-fit group-data-[role=user]/message:max-w-[88%] group-data-[role=user]/message:rounded-[22px] group-data-[role=user]/message:rounded-tr-md group-data-[role=user]/message:bg-primary-soft group-data-[role=user]/message:px-4 group-data-[role=user]/message:py-3 group-data-[role=user]/message:text-primary-ink";

export function MessageText({ text }: Readonly<{ text: string }>) {
  return <p className={TEXT_CLASS}>{text}</p>;
}

export function MessageTurn({ role, children }: Readonly<{ role: string; children: ReactNode }>) {
  return <li className={`chat-message chat-message--${role} group/message [display:flex] min-w-0 flex-col items-start gap-2`} data-role={role}>{children}</li>;
}
