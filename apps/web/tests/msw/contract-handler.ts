import { http, HttpResponse } from "msw";
import type { HttpHandler, JsonBodyType } from "msw";
import type { z } from "zod";

/**
 * Contract-typed MSW handler helpers.
 *
 * Handlers never hand-write JSON: the request body is `parse()`d with the
 * contract's zod input schema and every success body is `parse()`d with the
 * output schema, so a malformed fixture fails the request instead of leaking a
 * wrong shape. Errors use the oRPC OpenAPI wire envelope so the client link
 * decodes them into a typed `ORPCError` — identical on SSR and client.
 */
type Method = "get" | "post" | "delete";

export interface OrpcErrorBody {
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly data?: unknown;
}

export function orpcErrorResponse(error: OrpcErrorBody): HttpResponse<JsonBodyType> {
  const body = { defined: true, ...error };
  return HttpResponse.json(body, { status: error.status });
}

interface ContractHandlerSpec<In, Out> {
  readonly method: Method;
  readonly url: string;
  readonly input: z.ZodType<In>;
  readonly output: z.ZodType<Out>;
  readonly resolve: (input: In) => Out | OrpcErrorBody | Promise<Out | OrpcErrorBody>;
}

function isErrorBody(value: unknown): value is OrpcErrorBody {
  return typeof value === "object" && value !== null && "status" in value && "code" in value;
}

async function respond<In, Out>(
  spec: ContractHandlerSpec<In, Out>,
  raw: unknown,
): Promise<HttpResponse<JsonBodyType>> {
  const parsed = spec.input.safeParse(raw);
  if (!parsed.success) {
    return orpcErrorResponse({ code: "BAD_REQUEST", status: 400, message: parsed.error.message });
  }
  const result = await spec.resolve(parsed.data);
  if (isErrorBody(result)) {
    return orpcErrorResponse(result);
  }
  return HttpResponse.json(spec.output.parse(result) as JsonBodyType);
}

export function contractJsonHandler<In, Out>(spec: ContractHandlerSpec<In, Out>): HttpHandler {
  return http[spec.method](spec.url, ({ request }) => request.json().then((raw) => respond(spec, raw)));
}
