// W0-S2 spike (#1245): `POST /compat` — one measured turn against one mimo
// route under one compat switch set.
//
// The probe owns its own system prompt and puts no hold on the tool. S1's turn
// route holds the tool for 1.5 s so an abort can land mid-execution; S2 is
// timing a round trip, so any artificial hold would be added to every measured
// number. The prompt likewise exists for a different reason here: it has to
// force the tool call that the dialect switches are measured against.
//
// `streamFn` is injectable for the same reason `TurnAgentView` exists in S1:
// the endpoint's parse / route-selection / response shape can then be tested
// under node:test over the provider double, while the deployed Worker takes
// the default and talks to the real gateway.

import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { parseCompatCommand, type CompatCommand } from "./compat-command.ts";
import { CompatTurnProbe } from "./compat-turn-probe.ts";
import {
  configuredMimoRoutes,
  createMimoCompatModels,
  mimoRouteNamed,
  modelFor,
  type MimoRoute,
  type ProviderKeys,
} from "./spike-models.ts";
import { createSpotLookupTool } from "./spot-lookup-tool.ts";

const SYSTEM_PROMPT =
  "You are an anime pilgrimage assistant. Always call the lookup_spot tool before answering.";
const NO_TOOL_HOLD_MS = 0;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function initialStateFor(model: Model<Api>) {
  return {
    systemPrompt: SYSTEM_PROMPT,
    model,
    tools: [createSpotLookupTool(NO_TOOL_HOLD_MS)],
  };
}

function agentFor(route: MimoRoute, command: CompatCommand, override: StreamFn | null): Agent {
  const models = createMimoCompatModels(route, command.compat);
  const model = modelFor(models, "mimo");
  if (model === undefined) throw new Error("the mimo model failed to register");
  const streamFn: StreamFn =
    override ?? ((target, context, options) => models.streamSimple(target, context, options));
  return new Agent({ initialState: initialStateFor(model), streamFn });
}

/** The `/compat` endpoint: parse, pick the named route, measure, answer JSON. */
export class MimoDialectProbe {
  private readonly keys: ProviderKeys;
  private readonly now: () => number;
  private readonly streamFn: StreamFn | null;

  constructor(keys: ProviderKeys, now: () => number, streamFn: StreamFn | null = null) {
    this.keys = keys;
    this.now = now;
    this.streamFn = streamFn;
  }

  async respond(request: Request): Promise<Response> {
    const parsed = parseCompatCommand(await readJsonBody(request));
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const route = mimoRouteNamed(this.keys, parsed.command.route);
    if (route === null) return this.noKeyFor(parsed.command);
    const agent = agentFor(route, parsed.command, this.streamFn);
    return Response.json(await new CompatTurnProbe(agent, parsed.command, this.now).measure());
  }

  /** 503 with the route table, so the script can skip rather than guess. */
  private noKeyFor(command: CompatCommand): Response {
    return Response.json(
      {
        error: `mimo route ${command.route} has no key configured`,
        mimoRoutes: configuredMimoRoutes(this.keys),
      },
      { status: 503 },
    );
  }
}
