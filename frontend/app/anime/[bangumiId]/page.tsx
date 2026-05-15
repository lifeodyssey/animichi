import type { Metadata } from "next";
import type { AnimeGuideResponse } from "../../../lib/api/guide";
import { buildBreadcrumbJsonLd, buildAnimeGuideJsonLd } from "../../../lib/structured-data-guide";
import AnimeGuideClient from "./AnimeGuideClient";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:8080";
const SITE_URL = "https://seichijunrei.zhenjia.org";

async function fetchGuideServer(bangumiId: string, locale = "ja"): Promise<AnimeGuideResponse | null> {
  try {
    const res = await fetch(`${RUNTIME_URL}/v1/bangumi/${bangumiId}/guide?locale=${encodeURIComponent(locale)}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return (await res.json()) as AnimeGuideResponse;
  } catch {
    return null;
  }
}

type Props = { params: Promise<{ bangumiId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { bangumiId } = await params;
  const data = await fetchGuideServer(bangumiId);
  if (!data) {
    return { title: "Not Found | Seichijunrei" };
  }
  const title = `${data.title} 聖地巡礼ガイド | Seichijunrei`;
  const description = data.city
    ? `${data.title}の聖地 ${data.spot_count} スポット — ${data.city}。AIでルート計画も。`
    : `${data.title}の聖地 ${data.spot_count} スポット。AIでルート計画も。`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/anime/${bangumiId}`,
      siteName: "Seichijunrei",
      type: "website",
      ...(data.cover_url ? { images: [{ url: data.cover_url, width: 460, height: 650 }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(data.cover_url ? { images: [data.cover_url] } : {}),
    },
  };
}

/**
 * Server Component — fetches guide data, injects JSON-LD, renders client component.
 * JSON-LD content is built from our own structured data builders (no user input),
 * so dangerouslySetInnerHTML is safe here — this is the standard Next.js pattern.
 */
export default async function AnimeGuidePage({ params }: Props) {
  const { bangumiId } = await params;
  const data = await fetchGuideServer(bangumiId);

  return (
    <>
      {data && (
        <>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(buildBreadcrumbJsonLd(data.title, bangumiId)) }}
          />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(buildAnimeGuideJsonLd(data)) }}
          />
        </>
      )}
      <AnimeGuideClient initialData={data} bangumiId={bangumiId} />
    </>
  );
}
