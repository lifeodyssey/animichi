import { Button } from "animal-island-ui-tailwind/button";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

type Props = Readonly<{ src: string; name: string; caption?: string; closeLabel: string; failureMessage: string; onClose: () => void; footer?: ReactNode }>;

/** Native modal focus/inert behavior, without the library Modal's blob image crop. */
function useSceneDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); trigger?.focus({ preventScroll: true }); };
  }, []);
  return ref;
}

function PreviewImage({ src, name, failureMessage }: Pick<Props, "src" | "name" | "failureMessage">) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p role="status" className="grid min-h-48 place-items-center px-6 text-center text-base text-muted-fg">{failureMessage}</p>;
  return <img src={src} alt={name} className="block max-h-[65dvh] w-full object-contain" onError={() => { setFailed(true); }} />;
}

function PreviewHeader({ name, caption, closeLabel, onClose, titleId }: Omit<Props, "src" | "failureMessage"> & Readonly<{ titleId: string }>) {
  return (
    <header className="sticky top-0 flex items-start justify-between gap-4 bg-paper px-4 py-4 sm:px-6">
      <div className="grid min-w-0 gap-1"><h2 id={titleId} className="break-words text-lg font-bold text-fg">{name}</h2>{caption ? <p className="text-sm text-muted-fg">{caption}</p> : null}</div>
      <Button htmlType="button" type="text" onClick={onClose} className="shrink-0 [min-height:44px] [padding-inline:12px] [--animal-text-color:var(--color-fg)] focus-visible:outline-ground-ink motion-reduce:transition-none">{closeLabel}</Button>
    </header>
  );
}

export function ScenePreview(props: Props) {
  const ref = useSceneDialog();
  const titleId = useId();
  return (
    <dialog ref={ref} aria-labelledby={titleId} className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(60rem,calc(100%-2rem),calc(70dvh*16/9))] max-w-none overflow-y-auto rounded-2xl border-0 bg-paper p-0 text-fg shadow-xl backdrop:bg-ground-ink/70" onCancel={(event) => { event.preventDefault(); props.onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div><PreviewHeader {...props} titleId={titleId} /><PreviewImage key={props.src} {...props} />{props.footer}</div>
    </dialog>
  );
}
