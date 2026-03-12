import type { CodexHostServices } from "../host/codexHostServices.js";

export type CodexModelTransportMode = "auto" | "http" | "websocket";
export type CodexResolvedModelTransportMode = "http" | "websocket";

export interface CodexModelTransportPlan {
  requested_mode: CodexModelTransportMode;
  resolved_mode: CodexResolvedModelTransportMode;
  websocket_available: boolean;
  fallback_reason: string | null;
}

export interface CodexModelTransportExecution {
  plan: CodexModelTransportPlan;
  executed_mode: CodexResolvedModelTransportMode;
  fell_back_to_http: boolean;
  websocket_error: string | null;
}

export interface CodexModelTransportResolveOptions {
  requestedMode?: CodexModelTransportMode | null;
}

const MODEL_TRANSPORT_ENV_KEYS = [
  "TASKNERVE_MODEL_TRANSPORT",
  "TASKNERVE_MODEL_TRANSPORT_MODE",
] as const;

function normalizeMode(value: unknown): CodexModelTransportMode | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "auto" || text === "http" || text === "websocket") {
    return text;
  }
  return null;
}

export function readRequestedModelTransportMode(
  env: NodeJS.ProcessEnv = process.env,
): CodexModelTransportMode {
  for (const key of MODEL_TRANSPORT_ENV_KEYS) {
    const mode = normalizeMode(env[key]);
    if (mode) {
      return mode;
    }
  }
  return "auto";
}

export function websocketModelTransportAvailable(host: Partial<CodexHostServices>): boolean {
  return typeof host.startTurnWebSocket === "function";
}

export function resolveModelTransportPlan(
  host: Partial<CodexHostServices>,
  env: NodeJS.ProcessEnv = process.env,
  options: CodexModelTransportResolveOptions = {},
): CodexModelTransportPlan {
  const requested = options.requestedMode ?? readRequestedModelTransportMode(env);
  const websocketAvailable = websocketModelTransportAvailable(host);

  if (requested === "http") {
    return {
      requested_mode: requested,
      resolved_mode: "http",
      websocket_available: websocketAvailable,
      fallback_reason: null,
    };
  }

  if (requested === "websocket") {
    return websocketAvailable
      ? {
          requested_mode: requested,
          resolved_mode: "websocket",
          websocket_available: true,
          fallback_reason: null,
        }
      : {
          requested_mode: requested,
          resolved_mode: "http",
          websocket_available: false,
          fallback_reason: "Websocket transport requested but host startTurnWebSocket is unavailable",
        };
  }

  return websocketAvailable
    ? {
        requested_mode: requested,
        resolved_mode: "websocket",
        websocket_available: true,
        fallback_reason: null,
      }
    : {
        requested_mode: requested,
        resolved_mode: "http",
        websocket_available: false,
        fallback_reason: "Websocket transport is not yet available in this host build",
      };
}

export async function startTurnWithResolvedModelTransport(
  host: CodexHostServices,
  startTurnPayload: unknown,
  env: NodeJS.ProcessEnv = process.env,
  options: CodexModelTransportResolveOptions = {},
): Promise<CodexModelTransportExecution> {
  const plan = resolveModelTransportPlan(host, env, options);

  if (plan.resolved_mode === "websocket" && typeof host.startTurnWebSocket === "function") {
    try {
      await host.startTurnWebSocket(startTurnPayload);
      return {
        plan,
        executed_mode: "websocket",
        fell_back_to_http: false,
        websocket_error: null,
      };
    } catch (error) {
      await host.startTurn(startTurnPayload);
      return {
        plan,
        executed_mode: "http",
        fell_back_to_http: true,
        websocket_error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  await host.startTurn(startTurnPayload);
  return {
    plan,
    executed_mode: "http",
    fell_back_to_http: false,
    websocket_error: null,
  };
}
