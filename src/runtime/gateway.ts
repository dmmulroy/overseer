import type { JSONWebKeySet } from "jose";
export { ProjectObject } from "./project.ts";
export { WorkspaceCatalog } from "./workspace-catalog.ts";
import {
  AccessAuthenticationFailed,
  verifyAccessAssertion,
  type AccessConfiguration,
} from "../adapters/gateway/access-principal.ts";
import { handleApiRequest } from "../adapters/gateway/gateway-http.ts";
import { authenticationProblem } from "../adapters/gateway/problem-response.ts";
import { parseMutationMetadata } from "../adapters/gateway/request-context.ts";

/** Raw bindings available only at the Gateway composition root. */
type GatewayEnvironment = {
  readonly ASSETS?: { readonly fetch: (request: Request) => Promise<Response> };
  readonly ACCESS_AUDIENCE: string;
  readonly ACCESS_ISSUER: string;
  readonly ACCESS_JWKS?: string;
  readonly ALLOWED_ORIGIN: string;
};

function isJsonWebKeySet(input: unknown): input is JSONWebKeySet {
  return typeof input === "object" &&
    input !== null &&
    "keys" in input &&
    Array.isArray(input.keys) &&
    input.keys.every(
      (key) =>
        typeof key === "object" &&
        key !== null &&
        "kty" in key &&
        typeof key.kty === "string",
    );
}

type ParsedGatewayConfiguration =
  | {
      readonly _tag: "ValidGatewayConfiguration";
      readonly access: AccessConfiguration;
      readonly allowedOrigin: string;
    }
  | { readonly _tag: "InvalidGatewayConfiguration" };

function parseGatewayConfiguration(env: GatewayEnvironment): ParsedGatewayConfiguration {
  try {
    const issuer = new URL(env.ACCESS_ISSUER);
    const allowedOrigin = new URL(env.ALLOWED_ORIGIN);
    if (
      env.ACCESS_AUDIENCE.length === 0 ||
      issuer.protocol !== "https:" ||
      issuer.origin !== env.ACCESS_ISSUER.replace(/\/$/, "") ||
      allowedOrigin.origin !== env.ALLOWED_ORIGIN
    ) {
      return { _tag: "InvalidGatewayConfiguration" };
    }

    let jwks: JSONWebKeySet | null = null;
    if (env.ACCESS_JWKS !== undefined) {
      const parsed: unknown = JSON.parse(env.ACCESS_JWKS);
      if (!isJsonWebKeySet(parsed)) {
        return { _tag: "InvalidGatewayConfiguration" };
      }
      jwks = parsed;
    }
    return {
      _tag: "ValidGatewayConfiguration",
      access: {
        audience: env.ACCESS_AUDIENCE,
        issuer: issuer.origin,
        jwks,
      },
      allowedOrigin: allowedOrigin.origin,
    };
  } catch {
    return { _tag: "InvalidGatewayConfiguration" };
  }
}

export default {
  async fetch(request: Request, env: GatewayEnvironment): Promise<Response> {
    const requestId = crypto.randomUUID();
    const configuration = parseGatewayConfiguration(env);
    if (configuration._tag === "InvalidGatewayConfiguration") {
      return new Response("Overseer is unavailable", {
        status: 503,
        headers: { "cache-control": "no-store", "x-request-id": requestId },
      });
    }
    const principal = await verifyAccessAssertion(
      request.headers.get("cf-access-jwt-assertion"),
      configuration.access,
    );
    if (principal instanceof AccessAuthenticationFailed) {
      return authenticationProblem(requestId);
    }

    const isSafe = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
    const mutationMetadata = isSafe
      ? { agentSession: null }
      : parseMutationMetadata(
          request,
          principal,
          configuration.allowedOrigin,
          requestId,
        );
    if (mutationMetadata instanceof Response) {
      return mutationMetadata;
    }

    if (new URL(request.url).pathname.startsWith("/api")) {
      return handleApiRequest(request, {
        principal,
        requestId,
        agentSession: mutationMetadata.agentSession,
      });
    }
    if (env.ASSETS === undefined) {
      return new Response("Application assets are unavailable", {
        status: 503,
        headers: { "cache-control": "no-store", "x-request-id": requestId },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
