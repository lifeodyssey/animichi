"use client";

import { useState, useRef, type FormEvent } from "react";
import type { Dict, Locale } from "../../lib/i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

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
        // error.code: 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
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

  function handleStationSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = stationValue.trim();
    if (!value) return;
    onStation(value);
  }

  const isAcquiring = geoState.kind === "acquiring";

  return (
    <div
      className="mx-auto mb-2 flex max-w-[680px] flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm"
      role="region"
      aria-label="location prompt"
    >
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {!isAcquiring && geoState.kind !== "ok" && (
            <>
              <Button
                type="button"
                variant="chip"
                size="sm"
                onClick={handleUseCurrentLocation}
              >
                <span aria-hidden="true">📍</span>
                {t.use_current}
              </Button>
              {!showStationInput && (
                <Button
                  type="button"
                  variant="chip"
                  size="sm"
                  onClick={handleEnterStation}
                >
                  {t.enter_station}
                </Button>
              )}
            </>
          )}

          {isAcquiring && (
            <span className="text-sm text-muted-foreground">
              {t.acquiring}
            </span>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          aria-label="dismiss location prompt"
          className="ml-2 h-6 w-6"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </Button>
      </div>

      {(geoState.kind === "denied" || geoState.kind === "timeout") && (
        <p className="text-xs text-muted-foreground">
          {geoState.kind === "denied" ? t.denied : t.timeout}
        </p>
      )}

      {showStationInput && geoState.kind !== "acquiring" && (
        <form onSubmit={handleStationSubmit} className="flex gap-2">
          <Input
            ref={stationInputRef}
            size="sm"
            type="text"
            value={stationValue}
            onChange={(e) => setStationValue(e.target.value)}
            placeholder={t.enter_station}
            className="flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!stationValue.trim()}
          >
            OK
          </Button>
        </form>
      )}
    </div>
  );
}
