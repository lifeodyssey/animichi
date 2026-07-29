import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { healthzUrl } from "./config";

export type BackendHealthStatus = "pending" | "healthy" | "down";

export interface BackendHealth {
  readonly status: BackendHealthStatus;
  readonly healthy: boolean;
  readonly retry: () => void;
}

async function probeHealth(baseUrl: string): Promise<boolean> {
  const response = await fetch(healthzUrl(baseUrl));
  if (!response.ok) throw new Error(`healthz responded ${String(response.status)}`);
  return true;
}

function healthQueryOptions(baseUrl: string) {
  return {
    queryKey: ["chat", "healthz", baseUrl],
    queryFn: () => probeHealth(baseUrl),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  };
}

function toStatus(query: { isSuccess: boolean; isError: boolean }): BackendHealthStatus {
  if (query.isSuccess) return "healthy";
  return query.isError ? "down" : "pending";
}

/** A5 signal: the page is unreachable-aware via a one-shot healthz probe. */
export function useBackendHealth(baseUrl: string): BackendHealth {
  const query = useQuery(healthQueryOptions(baseUrl));
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  const status = toStatus(query);
  return { status, healthy: status === "healthy", retry };
}
