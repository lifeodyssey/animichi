import type { Point } from "@animichi/contract";
import { useCatalogSearch } from "../api/hooks/use-catalog-search";

type Props = Readonly<{ query: string }>;

function PointItem({ point }: Readonly<{ point: Point }>) {
  return <li className="catalog-result">{point.name}</li>;
}

function PointList({ points }: Readonly<{ points: readonly Point[] }>) {
  return (
    <ul aria-label="Pilgrimage points">
      {points.map((point) => (
        <PointItem key={point.id} point={point} />
      ))}
    </ul>
  );
}

export function CatalogSearchResults({ query }: Props) {
  const { data, isPending, isError } = useCatalogSearch({ query });
  if (isPending) {
    return <p role="status">Searching…</p>;
  }
  if (isError) {
    return <p role="alert">Search failed</p>;
  }
  return <PointList points={data.rows} />;
}
