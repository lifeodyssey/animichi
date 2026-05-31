"use client";

import { useState, useRef, type FormEvent } from "react";
import type { Dict, Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import FoxGuide from "../generative/FoxGuide";

type GeoState =
  | { kind: "idle" }
  | { kind: "acquiring" }
  | { kind: "denied" }
  | { kind: "timeout" }
  | { kind: "ok"; lat: number; lng: number };

interface LocationPromptProps {
  onCoords: (lat: number, lng: number) => void;
  onStation: (station: string) => void;
  onDismiss: () => void;
  dict: Dict;
  locale: Locale;
}

export default function LocationPrompt({
  onCoords,
  onStation,
  onDismiss,
  dict,
}: LocationPromptProps) {
  const t = dict.location;
  const tf = dict.fox_guide;
  const [geoState, setGeoState] = useState<GeoState>({ kind: "idle" });
  const [showStationInput, setShowStationInput] = useState(false);
  const [stationValue, setStationValue] = useState("");
  const stationInputRef = useRef<HTMLInputElement>(null);

  function handleUseCurrentLocation() {
    setGeoState({ kind: "acquiring" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setGeoState({ kind: "ok", lat, lng });
        onCoords(lat, lng);
      },
      (error) => {
        if (error.code === 3) {
          setGeoState({ kind: "timeout" });
        } else {
          setGeoState({ kind: "denied" });
        }
        setShowStationInput(true);
        setTimeout(() => stationInputRef.current?.focus(), 0);
      },
      { timeout: 10_000 },
    );
  }

  function handleEnterStation() {
    setShowStationInput(true);
    setTimeout(() => stationInputRef.current?.focus(), 0);
  }

  function handleSkip() {
    setShowStationInput(true);
    setTimeout(() => stationInputRef.current?.focus(), 0);
  }

  function handleStationSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = stationValue.trim();
    if (!value) return;
    onStation(value);
  }

  const isAcquiring = geoState.kind === "acquiring";
  const isIdle = geoState.kind === "idle";

  return (
    <div
      className="mx-auto mb-2 flex max-w-[680px] flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
      role="region"
      aria-label="location prompt"
    >
      {/* Header row: fox + title + dismiss */}
      <div className="flex items-start gap-3">
        <div className="relative h-20 w-20 shrink-0">
          <FoxGuide
            pose="welcome"
            size="sm"
            surface="permission"
          />
        </div>

        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-sm font-semibold text-foreground font-display">
            {tf.permission_title}
          </p>
          <p className="text-xs font-light leading-relaxed text-muted-foreground">
            {tf.permission_body}
          </p>
        </div>

        <Button
          ghost
          size="small"
          onClick={onDismiss}
          aria-label="dismiss location prompt"
          className="animal-btn-icon-only ml-1 h-6 w-6 shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </Button>
      </div>

      {/* Action buttons: allow / skip / manual */}
      {isIdle && !showStationInput && (
        <div className="flex flex-col gap-2">
          <Button
            type="primary"
            size="small"
            onClick={handleUseCurrentLocation}
            className="w-full"
          >
            <span aria-hidden="true">📍</span>
            {tf.permission_allow}
          </Button>
          <div className="flex gap-2">
            <Button
              type="default"
              size="small"
              onClick={handleEnterStation}
              className="flex-1 animal-btn-chip"
            >
              {tf.permission_manual}
            </Button>
            <Button
              type="default"
              size="small"
              onClick={handleSkip}
              aria-label={tf.permission_skip}
              className="flex-1 animal-btn-chip"
            >
              {tf.permission_skip}
            </Button>
          </div>
        </div>
      )}

      {isAcquiring && (
        <span className="text-sm text-muted-foreground">
          {t.acquiring}
        </span>
      )}

      {(geoState.kind === "denied" || geoState.kind === "timeout") && (
        <p className="text-xs text-muted-foreground">
          {geoState.kind === "denied" ? t.denied : t.timeout}
        </p>
      )}

      {showStationInput && !isAcquiring && (
        <form onSubmit={handleStationSubmit} className="flex gap-2">
          <Input
            shadow
            ref={stationInputRef}
            size="small"
            type="text"
            value={stationValue}
            onChange={(e) => setStationValue(e.target.value)}
            placeholder={t.enter_station}
            className="flex-1"
          />
          <Button
            htmlType="submit"
            type="primary"
            size="small"
            disabled={!stationValue.trim()}
          >
            OK
          </Button>
        </form>
      )}
    </div>
  );
}
