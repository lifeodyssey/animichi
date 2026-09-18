import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ANITABI_ATTRIBUTION,
  withAnitabiImagePlan,
  type AnitabiImagePlan,
} from "@animichi/contract/anitabi-display";

export type LandmarkImage = Readonly<{
  src: string;
  alt: string;
  plan: AnitabiImagePlan;
  className?: string;
}>;

export type LandmarkCredit = Readonly<{
  origin?: string;
  originUrl?: string;
}>;

type Props = Readonly<{ image: LandmarkImage; credit: LandmarkCredit }>;

type ShownShot = Readonly<{ ref: RefObject<HTMLDivElement | null>; src?: string }>;

/** A landmark screenshot with its origin credit paired beside it. */
export function LandmarkShot({ image, credit }: Props) {
  const shot = useLandmarkShot(image);
  return <ShotFigure image={image} credit={credit} shot={shot} />;
}

function ShotFigure({ image, credit, shot }: Props & Readonly<{ shot: ShownShot }>) {
  return (
    <figure className="m-0">
      <div ref={shot.ref}><LandmarkFrame image={image} src={shot.src} /></div>
      <ShotCredit credit={credit} />
    </figure>
  );
}

function useLandmarkShot(image: LandmarkImage) {
  const view = useElementShown();
  const src = view.shown ? withAnitabiImagePlan(image.src, image.plan) : undefined;
  return { ref: view.ref, src };
}

function useElementShown() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const node = ref.current;
    return watchShown(node, setShown);
  }, []);
  return { ref, shown };
}

function watchShown(node: HTMLElement | null, setShown: (shown: boolean) => void): () => void {
  if (node === null || typeof IntersectionObserver === "undefined") return () => undefined;
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) setShown(true);
  });
  observer.observe(node);
  return () => {
    observer.disconnect();
  };
}

function LandmarkFrame({ image, src }: Readonly<{ image: LandmarkImage; src?: string }>) {
  if (src === undefined) return <ShotPlaceholder alt={image.alt} className={image.className} />;
  return <img src={src} alt={image.alt} decoding="async" className={image.className} />;
}

function ShotPlaceholder({ alt, className }: Readonly<{ alt: string; className?: string }>) {
  return <div role="img" aria-label={alt} className={className} />;
}

export function ShotCredit({ credit }: Readonly<{ credit: LandmarkCredit }>) {
  const origin = credit.origin ?? ANITABI_ATTRIBUTION;
  return <p className="mt-1 text-xs text-[var(--color-muted-fg)]">{creditMark(origin, credit.originUrl)}</p>;
}

function creditMark(origin: string, originUrl: string | undefined) {
  if (originUrl === undefined) return origin;
  return <a href={originUrl} className="inline-flex min-h-11 items-center underline" rel="noreferrer">{origin}</a>;
}
