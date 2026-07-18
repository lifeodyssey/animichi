import type { ChangeEvent } from "react";
import { useCallback, useMemo, useState } from "react";
import type { ChatDict } from "../i18n";

type Props = Readonly<{
  dict: ChatDict;
  disabled: boolean;
  onSend: (text: string) => void;
}>;

type Submittable = Readonly<{ preventDefault: () => void }>;

function makeSubmit(text: string, reset: () => void, onSend: (t: string) => void) {
  return (event: Submittable) => {
    event.preventDefault();
    if (text.trim() === "") return;
    onSend(text.trim());
    reset();
  };
}

function useComposer(onSend: (text: string) => void) {
  const [text, setText] = useState("");
  const change = useCallback((event: ChangeEvent<HTMLInputElement>) => { setText(event.target.value); }, []);
  const reset = useCallback(() => { setText(""); }, []);
  const submit = useMemo(() => makeSubmit(text, reset, onSend), [text, reset, onSend]);
  return { text, change, submit };
}

export function ChatInput({ dict, disabled, onSend }: Props) {
  const composer = useComposer(onSend);
  return (
    <form className="chat-input" onSubmit={composer.submit}>
      <input className="chat-input__field" autoFocus value={composer.text} placeholder={dict.inputPlaceholder} aria-label={dict.inputPlaceholder} disabled={disabled} onChange={composer.change} />
      <button type="submit" className="chat-input__send" disabled={disabled || composer.text.trim() === ""}>{dict.send}</button>
    </form>
  );
}
