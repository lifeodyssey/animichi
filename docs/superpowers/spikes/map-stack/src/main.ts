import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { mountInteractiveMap } from "./interactive";
import { mountOfflineDemo } from "./offline";
import { registerPmtilesProtocol } from "./protocol";
import { getSourceMode, setSourceMode } from "./source-mode";
import { mountStaticCard } from "./static-card";

const requireElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id}`);
  }
  return element as T;
};

registerPmtilesProtocol();

const mode = getSourceMode();
requireElement<HTMLButtonElement>(`mode-${mode}`).classList.add("is-active");
requireElement<HTMLButtonElement>("mode-pmtiles").addEventListener("click", () => setSourceMode("pmtiles"));
requireElement<HTMLButtonElement>("mode-worker").addEventListener("click", () => setSourceMode("worker"));

mountStaticCard(
  requireElement<HTMLElement>("static-card"),
  requireElement<HTMLInputElement>("static-failure")
);
mountInteractiveMap(
  requireElement<HTMLElement>("interactive-map"),
  mode,
  requireElement<HTMLButtonElement>("fly-tokyo"),
  requireElement<HTMLButtonElement>("fly-uji")
);
mountOfflineDemo(
  requireElement<HTMLElement>("offline-map"),
  requireElement<HTMLButtonElement>("load-offline")
);
