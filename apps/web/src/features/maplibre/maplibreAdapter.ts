import type { Map as MapLibreMap, MapOptions, StyleSpecification } from "maplibre-gl";

export type MapLibreModule = typeof import("maplibre-gl");

export type MapLibreMountContext = Readonly<{
  gl: MapLibreModule;
  map: MapLibreMap;
}>;

export type MapLibreMountOptions = Readonly<{
  attributionControl?: MapOptions["attributionControl"];
  center?: MapOptions["center"];
  container: HTMLElement;
  interactive?: boolean;
  onError: () => void;
  onLoad?: (context: MapLibreMountContext) => (() => void) | undefined;
  onReady?: () => void;
  registerPmtiles?: boolean;
  style: StyleSpecification;
  zoom?: MapOptions["zoom"];
}>;

export type MapLibreHandle = Readonly<{
  destroy: () => void;
  map: MapLibreMap;
}>;

let pmtilesRegistration: Promise<void> | undefined;

// Cache the in-flight promise, not a boolean: a flag set before the dynamic
// import resolves lets a concurrent mount build a map while the protocol is
// still missing, and a flag left true after a failed import would skip
// registration for the rest of the session. Awaiting the shared promise
// serialises callers; clearing it on failure keeps the next mount retryable.
const registerPmtilesProtocol = (gl: MapLibreModule): Promise<void> => {
  pmtilesRegistration ??= (async () => {
    const { Protocol } = await import("pmtiles");
    gl.addProtocol("pmtiles", new Protocol({ metadata: true }).tile);
  })().catch((error: unknown) => {
    pmtilesRegistration = undefined;
    throw error;
  });
  return pmtilesRegistration;
};

const mapOptions = (options: MapLibreMountOptions): MapOptions => ({
  container: options.container,
  style: options.style,
  ...(options.interactive === undefined ? {} : { interactive: options.interactive }),
  ...(options.attributionControl === undefined ? {} : { attributionControl: options.attributionControl }),
  ...(options.center === undefined ? {} : { center: options.center }),
  ...(options.zoom === undefined ? {} : { zoom: options.zoom }),
});

const browserOnly = (): void => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("MapLibre can only mount in a browser");
  }
};

const ignoreError = (_error: unknown): void => undefined;

const bestEffort = (action: () => void): void => {
  try {
    action();
  } catch (error) {
    ignoreError(error);
  }
};

const removeMap = (map: MapLibreMap, releaseProtocolLease: (() => void) | undefined): void => {
  try {
    bestEffort(() => { map.remove(); });
  } finally {
    releaseProtocolLease?.();
  }
};

const removeListeners = (map: MapLibreMap, onError: () => void, onLoad: () => void): void => {
  bestEffort(() => { map.off("error", onError); });
  bestEffort(() => { map.off("load", onLoad); });
};

interface DisposeOptions {
  readonly loadCleanup: (() => void) | undefined;
  readonly map: MapLibreMap;
  readonly onError: () => void;
  readonly onLoad: () => void;
  readonly releaseProtocolLease?: () => void;
}

const dispose = (options: DisposeOptions): void => {
  removeListeners(options.map, options.onError, options.onLoad);
  bestEffort(() => { options.loadCleanup?.(); });
  removeMap(options.map, options.releaseProtocolLease);
};

interface ListenerOptions {
  readonly map: MapLibreMap;
  readonly onError: () => void;
  readonly onLoad: () => void;
  readonly releaseProtocolLease?: () => void;
}

const installListeners = (options: ListenerOptions): void => {
  try {
    options.map.on("error", options.onError);
    options.map.on("load", options.onLoad);
  } catch (error) {
    removeMap(options.map, options.releaseProtocolLease);
    throw error;
  }
};

interface MapLifecycleOptions {
  readonly gl: MapLibreModule;
  readonly map: MapLibreMap;
  readonly onError: () => void;
  readonly onLoad?: (context: MapLibreMountContext) => (() => void) | undefined;
  readonly onReady?: () => void;
  readonly releaseProtocolLease?: () => void;
}

class MapLifecycle implements MapLibreHandle {
  readonly map: MapLibreMap;
  private active = true;
  private failed = false;
  private loaded = false;
  private loadCleanup: (() => void) | undefined;
  private readonly options: MapLifecycleOptions;

  constructor(options: MapLifecycleOptions) {
    this.map = options.map;
    this.options = options;
    installListeners({ ...options, onError: this.reportError, onLoad: this.reportReady });
  }

  private readonly reportError = (): void => {
    if (!this.active || this.failed) return;
    this.failed = true;
    try {
      this.options.onError();
    } finally {
      this.destroy();
    }
  };

  private readonly handleReady = (): void => {
    const cleanup = this.options.onLoad?.({ gl: this.options.gl, map: this.map });
    this.loadCleanup = typeof cleanup === "function" ? cleanup : undefined;
    this.loaded = true;
    this.options.onReady?.();
  };

  private readonly reportReady = (): void => {
    if (!this.active || this.failed || this.loaded) return;
    try { this.handleReady(); } catch { this.reportError(); }
  };

  private readonly dispose = (): void => {
    dispose({
      loadCleanup: this.loadCleanup,
      map: this.map,
      onError: this.reportError,
      onLoad: this.reportReady,
      releaseProtocolLease: this.options.releaseProtocolLease,
    });
  };

  readonly destroy = (): void => {
    if (!this.active) return;
    this.active = false;
    this.dispose();
  };
}

const createMap = (gl: MapLibreModule, options: MapLibreMountOptions): MapLibreMap => {
  return new gl.Map(mapOptions(options));
};

export const mountMapLibre = async (options: MapLibreMountOptions): Promise<MapLibreHandle> => {
  browserOnly();
  const gl = await import("maplibre-gl");
  if (options.registerPmtiles) await registerPmtilesProtocol(gl);
  const map = createMap(gl, options);
  return new MapLifecycle({ ...options, gl, map });
};

interface Attachment {
  active: boolean;
  handle: MapLibreHandle | null;
}

const storeHandle = (attachment: Attachment, handle: MapLibreHandle): void => {
  if (!attachment.active) {
    handle.destroy();
    return;
  }
  attachment.handle = handle;
};

const reportAttachmentFailure = (attachment: Attachment, options: MapLibreMountOptions): void => {
  if (attachment.active) options.onError();
};

/** Bridge async MapLibre setup into React's synchronous effect cleanup contract. */
export const attachMapLibre = (options: MapLibreMountOptions): (() => void) => {
  const attachment: Attachment = { active: true, handle: null };
  void mountMapLibre(options)
    .then((handle) => { storeHandle(attachment, handle); })
    .catch(() => { reportAttachmentFailure(attachment, options); });
  return () => {
    attachment.active = false;
    attachment.handle?.destroy();
  };
};
