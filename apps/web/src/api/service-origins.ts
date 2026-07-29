export type ServiceEnvironment = "production" | "staging" | "preview" | "local";

export interface ServiceOrigins {
  readonly edge: string;
}

/** Edge Worker origins by deployment environment; catalog/users stay behind it. */
export const SERVICE_ORIGINS: Readonly<Record<ServiceEnvironment, ServiceOrigins>> = {
  staging: { edge: "https://staging.animichi.com" },
  production: { edge: "https://api.animichi.com" },
  preview: { edge: "https://staging.animichi.com" },
  local: { edge: "http://localhost:3000" },
};

const HOST_ENVIRONMENTS: Readonly<Record<string, ServiceEnvironment>> = {
  "animichi.com": "production",
  "staging.animichi.com": "staging",
  localhost: "local",
  "127.0.0.1": "local",
};

function workerEnvironment(hostname: string): ServiceEnvironment | undefined {
  if (hostname.startsWith("animichi-web-staging.")) return "staging";
  if (hostname.startsWith("animichi-web-preview.")) return "preview";
  if (hostname.startsWith("animichi-web.")) return "production";
  return undefined;
}

export function serviceEnvironment(origin: string): ServiceEnvironment | undefined {
  const hostname = new URL(origin).hostname;
  return HOST_ENVIRONMENTS[hostname] ?? workerEnvironment(hostname);
}

export function resolveServiceOrigins(origin: string): ServiceOrigins {
  const environment = serviceEnvironment(origin);
  if (!environment) throw new Error(`No service origins declared for ${origin}`);
  return SERVICE_ORIGINS[environment];
}
