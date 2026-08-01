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

interface ProtocolRegistration {
  gl: MapLibreModule;
  users: number;
}

let protocolRegistration: ProtocolRegistration | null = null;
let protocolRegistrationPromise: Promise<ProtocolRegistration> | null = null;

const releaseProtocol = (registration: ProtocolRegistration): void => {
  if (registration.users > 0) registration.users -= 1;
  if (registration.users !== 0 || protocolRegistration !== registration) return;
  try {
    if (typeof registration.gl.removeProtocol === "function") registration.gl.removeProtocol("pmtiles");
  } finally {
    protocolRegistration = null;
  }
};

const leaseProtocol = (registration: ProtocolRegistration): () => void => {
  registration.users += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseProtocol(registration);
  };
};

const createProtocolRegistration = async (gl: MapLibreModule): Promise<ProtocolRegistration> => {
  const { Protocol } = await import("pmtiles");
  gl.addProtocol("pmtiles", new Protocol({ metadata: true }).tile);
  return { gl, users: 0 };
};

const pendingProtocolRegistration = (gl: MapLibreModule): Promise<ProtocolRegistration> => {
  return protocolRegistrationPromise ?? (protocolRegistrationPromise = createProtocolRegistration(gl));
};

const clearPendingRegistration = (pending: Promise<ProtocolRegistration>): void => {
  if (protocolRegistrationPromise === pending) protocolRegistrationPromise = null;
};

const validateRegistration = (registration: ProtocolRegistration, gl: MapLibreModule): ProtocolRegistration => {
  if (registration.gl !== gl) throw new Error("MapLibre module changed while PMTiles was registering");
  return registration;
};

const awaitProtocolRegistration = async (gl: MapLibreModule): Promise<ProtocolRegistration> => {
  const pending = pendingProtocolRegistration(gl);
  return pending.then((registration) => {
    clearPendingRegistration(pending);
    return validateRegistration(registration, gl);
  }, (error: unknown) => {
    clearPendingRegistration(pending);
    throw error;
  });
};

const registerPmtilesProtocol = async (gl: MapLibreModule): Promise<ProtocolRegistration> => {
  if (protocolRegistration !== null) {
    if (protocolRegistration.gl !== gl) throw new Error("MapLibre module changed while PMTiles is mounted");
    return protocolRegistration;
  }
  const registration = await awaitProtocolRegistration(gl);
  protocolRegistration = registration;
  return registration;
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
    map.remove();
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

  private readonly reportReady = (): void => {
    if (!this.active || this.failed) return;
    try {
      const cleanup = this.options.onLoad?.({ gl: this.options.gl, map: this.map });
      this.loadCleanup = typeof cleanup === "function" ? cleanup : undefined;
      this.options.onReady?.();
    } catch {
      this.reportError();
    }
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

const createMap = (gl: MapLibreModule, options: MapLibreMountOptions, release: () => void): MapLibreMap => {
  try {
    return new gl.Map(mapOptions(options));
  } catch (error) {
    release();
    throw error;
  }
};

export const mountMapLibre = async (options: MapLibreMountOptions): Promise<MapLibreHandle> => {
  browserOnly();
  const gl = await import("maplibre-gl");
  const release = options.registerPmtiles ? leaseProtocol(await registerPmtilesProtocol(gl)) : () => undefined;
  const map = createMap(gl, options, release);
  return new MapLifecycle({ ...options, gl, map, releaseProtocolLease: release });
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
