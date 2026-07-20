import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  AccessAudience,
  makeAccessAssertionVerifier,
  type AccessAssertionVerifier,
  type AccessConfiguration,
} from "../adapters/gateway/access-principal.ts";
import { handleApiRequest } from "../adapters/gateway/gateway-http.ts";
import {
  authenticationProblem,
  problemResponse,
} from "../adapters/gateway/problem-response.ts";
import { parseMutationMetadata } from "../adapters/gateway/request-context.ts";
import { RequestId } from "../domain/actor.ts";

export { ProjectObject } from "./project.ts";
export { WorkspaceCatalog } from "./workspace-catalog.ts";

/** Raw bindings available only at the Gateway composition root. */
type GatewayEnvironment = {
  readonly ASSETS?: { readonly fetch: (request: Request) => Promise<Response> };
  readonly ACCESS_AUDIENCE: string;
  readonly ACCESS_ISSUER: string;
  readonly ALLOWED_ORIGIN: string;
};

type CachedAccessVerifier = {
  readonly audience: AccessConfiguration["audience"];
  readonly issuer: string;
  readonly verify: AccessAssertionVerifier;
};

// The Worker isolate owns JOSE's remote key cache. A binding change replaces it.
let cachedAccessVerifier: CachedAccessVerifier | null = null;

function accessVerifierFor(config: AccessConfiguration): AccessAssertionVerifier {
  if (
    cachedAccessVerifier === null ||
    cachedAccessVerifier.audience !== config.audience ||
    cachedAccessVerifier.issuer !== config.issuer.origin
  ) {
    cachedAccessVerifier = {
      audience: config.audience,
      issuer: config.issuer.origin,
      verify: makeAccessAssertionVerifier(config),
    };
  }
  return cachedAccessVerifier.verify;
}

type ValidGatewayConfiguration = {
  readonly _tag: "ValidGatewayConfiguration";
  readonly access: AccessConfiguration;
  readonly allowedOrigin: URL;
};

const GatewayConfigurationField = Schema.Literals([
  "ACCESS_AUDIENCE",
  "ACCESS_ISSUER",
  "ALLOWED_ORIGIN",
]);
type GatewayConfigurationField = typeof GatewayConfigurationField.Type;

class InvalidGatewayConfiguration extends Schema.TaggedErrorClass<InvalidGatewayConfiguration>()(
  "InvalidGatewayConfiguration",
  {
    field: GatewayConfigurationField,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {
  constructor(field: GatewayConfigurationField, cause: unknown) {
    super({ field, message: `The ${field} Gateway configuration is invalid`, cause });
  }
}

function parseUrlConfiguration(
  input: string,
  field: "ACCESS_ISSUER" | "ALLOWED_ORIGIN",
): URL | InvalidGatewayConfiguration {
  try {
    return new URL(input);
  } catch (cause) {
    return new InvalidGatewayConfiguration(field, cause);
  }
}

function parseGatewayConfiguration(
  env: GatewayEnvironment,
): ValidGatewayConfiguration | InvalidGatewayConfiguration {
  const audience = Schema.decodeUnknownOption(AccessAudience)(env.ACCESS_AUDIENCE);
  if (Option.isNone(audience)) {
    return new InvalidGatewayConfiguration(
      "ACCESS_AUDIENCE",
      new Error("The Access audience is empty"),
    );
  }
  const issuer = parseUrlConfiguration(env.ACCESS_ISSUER, "ACCESS_ISSUER");
  if (issuer instanceof InvalidGatewayConfiguration) {
    return issuer;
  }
  if (
    issuer.protocol !== "https:" ||
    issuer.origin !== env.ACCESS_ISSUER.replace(/\/$/, "")
  ) {
    return new InvalidGatewayConfiguration(
      "ACCESS_ISSUER",
      new Error("The Access issuer must be an HTTPS origin"),
    );
  }
  const allowedOrigin = parseUrlConfiguration(env.ALLOWED_ORIGIN, "ALLOWED_ORIGIN");
  if (allowedOrigin instanceof InvalidGatewayConfiguration) {
    return allowedOrigin;
  }
  if (allowedOrigin.origin !== env.ALLOWED_ORIGIN) {
    return new InvalidGatewayConfiguration(
      "ALLOWED_ORIGIN",
      new Error("The allowed Origin must be an exact origin"),
    );
  }
  return {
    _tag: "ValidGatewayConfiguration",
    access: {
      audience: audience.value,
      issuer,
    },
    allowedOrigin,
  };
}

/** Authenticate and serve one Gateway request at the Cloudflare entrypoint. */
export default {
  async fetch(request: Request, env: GatewayEnvironment): Promise<Response> {
    const requestId = RequestId.make(crypto.randomUUID());
    try {
      const configuration = parseGatewayConfiguration(env);
      if (configuration instanceof InvalidGatewayConfiguration) {
        console.error("Gateway configuration invalid", {
          field: configuration.field,
          error_type: configuration._tag,
        });
        return problemResponse({
          code: "gateway_unavailable",
          detail: "The Gateway configuration is invalid.",
          requestId,
        });
      }
      const assertion = request.headers.get("cf-access-jwt-assertion");
      const authentication = await Effect.runPromise(
        Effect.result(accessVerifierFor(configuration.access)(
          assertion === null ? null : Redacted.make(assertion),
        )),
      );
      if (Result.isFailure(authentication)) {
        return authentication.failure.reason === "verification_unavailable"
          ? problemResponse({
              code: "authentication_unavailable",
              detail: "Overseer could not verify the Access assertion.",
              requestId,
            })
          : authenticationProblem(requestId);
      }
      const principal = authentication.success;

      const isSafe = request.method === "GET" ||
        request.method === "HEAD" ||
        request.method === "OPTIONS";
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

      const pathname = new URL(request.url).pathname;
      if (pathname === "/api" || pathname.startsWith("/api/")) {
        return handleApiRequest(request, { requestId });
      }
      if (env.ASSETS === undefined) {
        return new Response("Application assets are unavailable", {
          status: 503,
          headers: { "cache-control": "no-store", "x-request-id": requestId },
        });
      }
      return await env.ASSETS.fetch(request);
    } catch (cause) {
      console.error("Gateway request defect", {
        request_id: requestId,
        error_type: cause instanceof Error ? cause.name : "unknown",
      });
      return problemResponse({
        code: "internal_error",
        detail: "Overseer could not complete the request.",
        requestId,
      });
    }
  },
};
