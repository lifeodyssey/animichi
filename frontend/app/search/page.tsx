"use client";

import { useEffect, useReducer } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useDict, useLocale } from "../../lib/i18n-context";
import { fetchSearchPreview } from "../../lib/api";
import type { SearchPreviewResponse } from "../../lib/api";
import type { PilgrimagePoint } from "../../lib/types";
import { handleImageError } from "../../components/auth/LandingData";
import SharedHeader from "../../components/layout/SharedHeader";

type Status = "idle" | "loading" | "done" | "error";

type State = { data: SearchPreviewResponse | null; status: Status };
type Action =
  | { type: "fetch" }
  | { type: "done"; data: SearchPreviewResponse }
  | { type: "error" };

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case "fetch": return { data: null, status: "loading" };
    case "done": return { data: action.data, status: "done" };
    case "error": return { data: null, status: "error" };
  }
}

export default function SearchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get("q") ?? "";
  const dict = useDict();
  const t = dict.search_preview;
  const locale = useLocale() as "ja" | "zh" | "en";

  const [{ data, status }, dispatch] = useReducer(reducer, {
    data: null,
    status: query ? "loading" : "idle",
  });

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    dispatch({ type: "fetch" });

    fetchSearchPreview(query, locale, controller.signal)
      .then((res) => {
        const bangumiId = res.results.metadata?.bangumi_id;
        if (bangumiId && res.results.status === "ok") {
          router.replace(`/anime/${bangumiId}`);
          return;
        }
        dispatch({ type: "done", data: res });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        dispatch({ type: "error" });
      });

    return () => controller.abort();
  }, [query, locale]);

  const rows = data?.results.rows ?? [];
  const meta = data?.results.metadata;
  const total = data?.results.total_available ?? 0;
  const isEmpty = status === "done" && rows.length === 0;

  return (
    <div
      className="min-h-screen bg-[var(--color-bg)]"
      style={{ fontFamily: "var(--app-font-body)" }}
    >
      <SharedHeader loginHref="/?login=true" />

      <main className="mx-auto max-w-[960px] px-5 py-10 sm:px-8 sm:py-16">
        {/* ── Back link ── */}
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-[14px] text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-fg)]"
        >
          <span aria-hidden="true">←</span>
          {t.back_to_home}
        </Link>

        {/* ── Title area ── */}
        {query && (
          <div className="mb-10">
            <h1 className="font-[family-name:var(--app-font-display)] text-[clamp(28px,5vw,42px)] font-bold leading-[1.1] text-[var(--color-fg)]">
              {t.title.replace("{query}", query)}
            </h1>
            {meta?.cover_url && (
              <div className="mt-4 flex items-center gap-3">
                <img
                  src={meta.cover_url}
                  alt=""
                  className="h-12 w-9 rounded object-cover"
                  onError={handleImageError}
                />
                <div>
                  <div className="text-[16px] font-medium text-[var(--color-fg)]">
                    {meta.anime_title}
                  </div>
                  {meta.anime_title_cn && meta.anime_title_cn !== meta.anime_title && (
                    <div className="text-[14px] text-[var(--color-muted-fg)]">
                      {meta.anime_title_cn}
                    </div>
                  )}
                </div>
              </div>
            )}
            {status === "done" && !isEmpty && (
              <p className="mt-3 text-[14px] text-[var(--color-muted-fg)]">
                {t.showing_preview
                  .replace("{shown}", String(rows.length))
                  .replace("{total}", String(total))}
              </p>
            )}
          </div>
        )}

        {/* ── Loading ── */}
        {status === "loading" && (
          <div className="flex items-center gap-3 py-16 text-[16px] text-[var(--color-muted-fg)]">
            <span
              className="inline-block h-4 w-4 rounded-full border-2 border-[var(--color-primary)] border-t-transparent"
              style={{ animation: "spin 0.8s linear infinite" }}
            />
            {t.loading}
          </div>
        )}

        {/* ── Error ── */}
        {status === "error" && (
          <div className="py-16 text-center">
            <p className="text-[16px] text-[var(--color-muted-fg)]">{t.error}</p>
            <Link
              href="/"
              className="mt-4 inline-block text-[14px] text-[var(--color-primary)] hover:underline"
            >
              {t.back_to_home}
            </Link>
          </div>
        )}

        {/* ── Empty results ── */}
        {isEmpty && (
          <div className="py-16 text-center">
            <p className="text-[18px] font-medium text-[var(--color-fg)]">
              {t.no_results}
            </p>
            <p className="mt-2 text-[14px] text-[var(--color-muted-fg)]">
              {t.no_results_hint}
            </p>
            <Link
              href="/"
              className="mt-6 inline-block text-[14px] text-[var(--color-primary)] hover:underline"
            >
              {t.back_to_home}
            </Link>
          </div>
        )}

        {/* ── Results list ── */}
        {rows.length > 0 && (
          <div className="space-y-3">
            {rows.map((point: PilgrimagePoint) => (
              <div
                key={point.id}
                className="flex gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 transition-colors hover:bg-[var(--color-card)]"
              >
                {/* Thumbnail */}
                {point.screenshot_url && (
                  <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg">
                    <img
                      src={point.screenshot_url}
                      alt={point.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      onError={handleImageError}
                    />
                  </div>
                )}
                {/* Details */}
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium text-[var(--color-fg)]">
                    {locale === "zh" && point.name_cn ? point.name_cn : point.name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-muted-fg)]">
                    {point.episode != null && (
                      <span>{t.episode_label.replace("{ep}", String(point.episode))}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Login CTA ── */}
        {status === "done" && rows.length > 0 && total > rows.length && (
          <div className="mt-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-8 text-center">
            <p className="text-[16px] text-[var(--color-muted-fg)]">
              {t.login_for_more}
            </p>
            <Link
              href="/?login=true"
              className="mt-4 inline-flex min-h-[48px] items-center rounded-xl bg-[var(--color-primary)] px-8 text-[15px] font-semibold text-[var(--color-primary-fg)] transition-opacity hover:opacity-90"
            >
              {t.login_button}
            </Link>
          </div>
        )}

        {/* ── No query ── */}
        {!query && (
          <div className="py-16 text-center">
            <p className="text-[18px] font-medium text-[var(--color-fg)]">
              {t.no_results_hint}
            </p>
            <Link
              href="/"
              className="mt-4 inline-block text-[14px] text-[var(--color-primary)] hover:underline"
            >
              {t.back_to_home}
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
