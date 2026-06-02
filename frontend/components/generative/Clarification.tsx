"use client";

import Image from "next/image";
import { useState } from "react";
import { useDict } from "../../lib/i18n-context";
import type { ClarifyCandidate } from "../../lib/types";
import { Button } from "@/components/ui/button";
import FoxGuide from "./FoxGuide";

export type { ClarifyCandidate };

interface ClarificationProps {
  message: string;
  options?: string[];
  candidates?: ClarifyCandidate[];
  onSuggest?: (text: string) => void;
}

export default function Clarification({
  message,
  options,
  candidates,
  onSuggest,
}: ClarificationProps) {
  const { clarification: t } = useDict();

  const hasCandidates = candidates !== undefined && candidates.length > 0;
  const hasOptions = options !== undefined && options.length > 0;

  // If we have candidate objects, render the vertical card layout
  if (hasCandidates) {
    return (
      <div className="relative flex flex-col gap-3">
        {/* Fox guide — thinking pose for the clarification / disambiguation state */}
        <FoxGuide
          pose="thinking"
          size="sm"
          surface="loading"
          className="-top-2 right-0"
        />
        <p className="text-sm font-light leading-relaxed text-foreground">
          {message}
        </p>
        <p className="text-xs text-muted-foreground">
          {t.candidates_hint}
        </p>
        <div className="flex flex-col gap-3">
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.title}
              candidate={candidate}
              onSelect={() => onSuggest?.(candidate.title)}
            />
          ))}
          <SearchAllCard
            label={t.search_all}
            candidates={candidates}
            onSuggest={onSuggest}
          />
        </div>
      </div>
    );
  }

  // If we have plain string options (legacy), convert to candidate-like cards
  if (hasOptions) {
    const syntheticCandidates: ClarifyCandidate[] = options.map((opt) => ({
      title: opt,
      cover_url: null,
      spot_count: 0,
      city: "",
    }));
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-light leading-relaxed text-foreground">
          {message}
        </p>
        <div className="flex flex-col gap-3">
          {syntheticCandidates.map((c) => (
            <CandidateCard
              key={c.title}
              candidate={c}
              onSelect={() => onSuggest?.(c.title)}
            />
          ))}
        </div>
      </div>
    );
  }

  // Default fallback: suggestion buttons from dictionary as candidate-like cards
  return (
    <div className="relative flex flex-col gap-3">
      {/* Fox guide — traveler pose for the fallback/uncertain state (no clear candidates) */}
      <FoxGuide
        pose="traveler"
        size="sm"
        surface="empty"
        className="-top-2 right-0"
      />
      <p className="text-sm font-light leading-relaxed text-foreground">
        {message}
      </p>
      <div className="flex flex-col gap-2">
        {t.suggestions.map((s) => (
          <FallbackSuggestionCard
            key={s.label}
            label={s.label}
            onSelect={() => onSuggest?.(s.query)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CandidateCard — anime cover art thumbnail + title + spot count + city
// ---------------------------------------------------------------------------

function CandidateCard({
  candidate,
  onSelect,
}: {
  candidate: ClarifyCandidate;
  onSelect: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const { clarification: t } = useDict();

  return (
    <Button
      type="dashed"
      size="middle"
      onClick={onSelect}
      aria-label={candidate.title}
      className="w-full justify-start gap-3 p-5 font-normal hover:-translate-y-0.5 hover:border-primary hover:shadow-sm active:translate-y-0"
    >
      {/* Thumbnail — enlarged for better anime cover visibility */}
      <span className="relative flex h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
        {candidate.cover_url && !imgError ? (
          <Image
            unoptimized
            src={candidate.cover_url}
            alt={candidate.title}
            width={44}
            height={56}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <PlaceholderThumbnail />
        )}
      </span>

      {/* Text */}
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span
          className="truncate text-sm font-medium text-foreground font-display"
        >
          {candidate.title}
        </span>
        {(candidate.spot_count > 0 || candidate.city) && (
          <span className="text-xs text-muted-foreground">
            {candidate.spot_count > 0 && <>{candidate.spot_count} {t.spot_label ?? "spots"}</>}
            {candidate.spot_count > 0 && candidate.city && " · "}
            {candidate.city}
          </span>
        )}
      </span>

      {/* Arrow */}
      <span className="shrink-0 text-base text-primary">
        →
      </span>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// SearchAllCard — "全作品まとめて検索" option at the bottom
// ---------------------------------------------------------------------------

function SearchAllCard({
  label,
  candidates,
  onSuggest,
}: {
  label: string;
  candidates: ClarifyCandidate[];
  onSuggest?: (text: string) => void;
}) {
  function handleClick() {
    // Build a combined query covering all candidate titles
    const titles = candidates.map((c) => c.title).join("・");
    onSuggest?.(titles);
  }

  return (
    <Button
      type="dashed"
      size="middle"
      onClick={handleClick}
      aria-label={label}
      className="w-full justify-start gap-3 p-5 font-normal hover:-translate-y-0.5 hover:border-primary hover:shadow-sm active:translate-y-0"
    >
      {/* Icon */}
      <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-sm">
        {"\uD83D\uDD0D"}
      </span>

      {/* Text */}
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span
          className="truncate text-sm font-medium text-foreground font-display"
        >
          {label}
        </span>
      </span>

      {/* Arrow */}
      <span className="shrink-0 text-base text-primary">
        →
      </span>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// FallbackSuggestionCard — used when there are no options or candidates
// ---------------------------------------------------------------------------

function FallbackSuggestionCard({
  label,
  onSelect,
}: {
  label: string;
  onSelect: () => void;
}) {
  return (
    <Button
      type="dashed"
      size="middle"
      onClick={onSelect}
      aria-label={label}
      className="w-full justify-start gap-3 p-5 font-normal hover:-translate-y-0.5 hover:border-primary hover:shadow-sm active:translate-y-0"
    >
      {/* Emoji icon instead of cover */}
      <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-sm">
        {"\uD83C\uDFAC"}
      </span>

      {/* Text */}
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span
          className="truncate text-sm font-medium text-foreground font-display"
        >
          {label}
        </span>
      </span>

      {/* Arrow */}
      <span className="shrink-0 text-base text-primary">
        →
      </span>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// PlaceholderThumbnail — shown when cover_url is null or image fails to load
// ---------------------------------------------------------------------------

function PlaceholderThumbnail() {
  return (
    <span className="flex h-full w-full items-center justify-center text-muted-foreground">
      {"\uD83C\uDFAC"}
    </span>
  );
}
