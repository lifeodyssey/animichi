import type { AnimeScene } from "@seichijunrei/contract";
import type { BubbleMapCopy } from "./copy";

type Props = Readonly<{
  region: string;
  scenes: readonly AnimeScene[];
  copy: BubbleMapCopy;
  onClose: () => void;
}>;

/** Only real http(s) URLs may hit `<img src>`: `src=""` re-requests the page itself. */
function hasRenderableShot(url: string | null): url is string {
  if (url === null || !URL.canParse(url)) return false;
  const protocol = new URL(url).protocol;
  return protocol === "https:" || protocol === "http:";
}

function SpotShot({ scene, copy }: Readonly<{ scene: AnimeScene; copy: BubbleMapCopy }>) {
  if (!hasRenderableShot(scene.screenshot_url)) {
    return (
      <div role="img" aria-label={scene.name} className="grid aspect-video w-full place-items-center rounded-lg bg-[var(--color-muted)] text-xs text-[var(--color-muted-fg)]">
        {copy.noPhoto}
      </div>
    );
  }
  return <img src={scene.screenshot_url} alt={scene.name} loading="lazy" className="aspect-video w-full rounded-lg object-cover" />;
}

function SpotItem({ scene, copy }: Readonly<{ scene: AnimeScene; copy: BubbleMapCopy }>) {
  return (
    <li className="rounded-xl bg-[var(--color-card)] p-2">
      <SpotShot scene={scene} copy={copy} />
      <p className="mb-0 font-bold">{scene.name}</p>
      <p className="my-0 text-sm text-[var(--color-muted-fg)]">{copy.shotCount(scene.shot_count)}</p>
    </li>
  );
}

function SpotList({ scenes, copy }: Readonly<{ scenes: readonly AnimeScene[]; copy: BubbleMapCopy }>) {
  if (scenes.length === 0) {
    return <p className="text-[var(--color-muted-fg)]">{copy.sheetEmpty}</p>;
  }
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {scenes.map((scene) => <SpotItem key={scene.id} scene={scene} copy={copy} />)}
    </ul>
  );
}

function SheetHeader({ title, close, onClose }: Readonly<{ title: string; close: string; onClose: () => void }>) {
  return (
    <header className="mb-3 flex items-center justify-between">
      <h3 className="m-0 text-base">{title}</h3>
      <button type="button" onClick={onClose} className="text-sm text-[var(--color-muted-fg)]">{close}</button>
    </header>
  );
}

/** Shot-angle (機位) sheet for a tapped region; graceful when a spot has no photo. */
export function SpotSheet({ region, scenes, copy, onClose }: Props) {
  return (
    <aside role="dialog" aria-label={copy.sheetTitle(region)} className="rounded-2xl bg-[var(--color-bg)] p-4 shadow-lg">
      <SheetHeader title={copy.sheetTitle(region)} close={copy.close} onClose={onClose} />
      <SpotList scenes={scenes} copy={copy} />
    </aside>
  );
}
