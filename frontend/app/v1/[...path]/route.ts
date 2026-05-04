import { type NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface ContainerBinding {
  idFromName: (name: string) => unknown;
  get: (id: unknown) => { fetch: (req: Request) => Promise<Response> };
}

/**
 * Catch-all API proxy: forwards /v1/* to the Python container
 * via Cloudflare Durable Object binding.
 *
 * Auth is handled by middleware.ts BEFORE this route handler runs.
 * Middleware injects X-User-Id and X-User-Type headers for
 * authenticated requests, and returns 401 for unauthenticated ones.
 *
 * In local dev (next dev), this falls back to HTTP proxy via
 * NEXT_PUBLIC_RUNTIME_URL because CF bindings aren't available.
 */
async function proxyToContainer(request: NextRequest): Promise<Response> {
  // Production: use Durable Object binding
  try {
    const ctx = await getCloudflareContext();
    const container = (ctx.env as Record<string, unknown>).CONTAINER as ContainerBinding | undefined;
    if (!container) throw new Error("CONTAINER binding not available");
    const id = container.idFromName("default");
    return container.get(id).fetch(request);
  } catch {
    // Local dev fallback: proxy via HTTP
    const runtimeUrl = process.env.NEXT_PUBLIC_RUNTIME_URL;
    if (!runtimeUrl) {
      return NextResponse.json(
        { error: { code: "unavailable", message: "Container not available." } },
        { status: 503 },
      );
    }
    const url = new URL(request.url);
    const target = `${runtimeUrl}${url.pathname}${url.search}`;
    return fetch(target, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
  }
}

export async function GET(request: NextRequest) {
  return proxyToContainer(request);
}

export async function POST(request: NextRequest) {
  return proxyToContainer(request);
}

export async function PUT(request: NextRequest) {
  return proxyToContainer(request);
}

export async function DELETE(request: NextRequest) {
  return proxyToContainer(request);
}

export async function PATCH(request: NextRequest) {
  return proxyToContainer(request);
}
