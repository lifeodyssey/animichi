import type { StyleSpecification } from "maplibre-gl";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { attachMapLibre } from "../../features/maplibre/maplibreAdapter";

export const Route = createFileRoute("/_dev/map-canary")({
  component: MapCanaryRoute,
});

type CanaryMode = "fallback" | "happy";
type CanaryStatus = "fallback" | "loading" | "ready" | "unmounted";

const readMode = (): CanaryMode => {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "fallback") {
    return "fallback";
  }
  return "happy";
};

const canaryStyle = (): StyleSpecification => ({
  version: 8,
  name: "animichi-maplibre-canary",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f8f8f0" } }],
});

type SetCanaryStatus = (status: CanaryStatus) => void;

const canaryOptions = (container: HTMLDivElement, mode: CanaryMode, setStatus: SetCanaryStatus) => ({
  container,
  interactive: false,
  onError: () => { setStatus("fallback"); },
  onLoad: mode === "fallback" ? () => { throw new Error("canary setup failure"); } : undefined,
  onReady: () => { setStatus("ready"); },
  style: canaryStyle(),
});

function useCanaryMount(containerRef: RefObject<HTMLDivElement | null>, mode: CanaryMode, mounted: boolean, setStatus: SetCanaryStatus): void {
  useEffect(() => {
    if (!mounted || !containerRef.current) {
      setStatus("unmounted");
      return undefined;
    }
    setStatus("loading");
    return attachMapLibre(canaryOptions(containerRef.current, mode, setStatus));
  }, [containerRef, mode, mounted, setStatus]);
}

const UnmountButton = ({ mounted, setMounted }: Readonly<{ mounted: boolean; setMounted: (mounted: boolean) => void }>) => {
  return <button type="button" disabled={!mounted} onClick={() => { setMounted(false); }}>Unmount map</button>;
};

const CanaryContainer = ({ containerRef }: Readonly<{ containerRef: RefObject<HTMLDivElement | null> }>) => {
  return <div ref={containerRef} data-testid="maplibre-canary-container" />;
};

interface CanaryViewProps {
  containerRef: RefObject<HTMLDivElement | null>;
  mode: CanaryMode;
  mounted: boolean;
  setMounted: (mounted: boolean) => void;
  status: CanaryStatus;
}

function CanaryView({ containerRef, mode, mounted, setMounted, status }: CanaryViewProps) {
  return (
    <main data-mode={mode} data-status={status} data-testid="maplibre-canary">
      <h1>MapLibre v5 canary</h1>
      <p aria-live="polite">Status: {status}</p>
      <UnmountButton mounted={mounted} setMounted={setMounted} />
      <CanaryContainer containerRef={containerRef} />
    </main>
  );
}

function MapCanaryRoute() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode] = useState<CanaryMode>(readMode);
  const [mounted, setMounted] = useState(true);
  const [status, setStatus] = useState<CanaryStatus>("loading");
  useCanaryMount(containerRef, mode, mounted, setStatus);
  return <CanaryView containerRef={containerRef} mode={mode} mounted={mounted} setMounted={setMounted} status={status} />;
}
