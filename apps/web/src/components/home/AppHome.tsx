import { ContinueFromCard } from "./ContinueFromCard";
import { PopularRanking } from "./PopularRanking";
import { SearchBox } from "./SearchBox";

interface AppHomeProps {
  readonly onSearch: (query: string) => void;
}

/** Authenticated App Home: search + 続きから + 人気ランキング (spec S5.5). */
export function AppHome({ onSearch }: AppHomeProps) {
  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-4 py-8">
      <SearchBox onSubmit={onSearch} />
      <ContinueFromCard />
      <PopularRanking />
    </main>
  );
}
