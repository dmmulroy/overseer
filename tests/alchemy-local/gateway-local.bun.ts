import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { Gateway } from "../../src/infra/gateway-resource.ts";
import GatewayLive from "../../src/infra/gateway.ts";

const { test } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});

const localGatewayConfigProvider = ConfigProvider.fromUnknown({
  ACCESS_AUDIENCE: "local-development",
  ALCHEMY_DEV: true,
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://access.local.invalid",
  OVERSEER_ALLOWED_ORIGIN: "http://localhost:1337",
  OVERSEER_AUTHENTICATION_MODE: "local-human",
  OVERSEER_HOSTNAME: "localhost",
});

const LocalDiscoveryDocument = Schema.Struct({
  name: Schema.Literal("Overseer"),
});

test.provider(
  "local Gateway authenticates one fixed human without production Access provisioning",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const gateway = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Gateway;
        }).pipe(
          Effect.provide(GatewayLive),
          Effect.provide(ConfigProvider.layer(localGatewayConfigProvider)),
        ),
      );

      if (gateway.url === undefined) {
        return yield* Effect.die("Alchemy local Gateway did not return a URL");
      }

      const client = yield* HttpClient.HttpClient;
      const discoveryResponse = yield* client.get(new URL("/api", gateway.url));
      yield* discoveryResponse.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(LocalDiscoveryDocument)),
      );

      const origin = new URL(gateway.url).origin;
      const createWorkspaceResponse = yield* client.execute(
        HttpClientRequest.post(new URL("/api/workspaces", gateway.url)).pipe(
          HttpClientRequest.setHeaders({
            "idempotency-key": "local-authentication-regression",
            origin,
          }),
          HttpClientRequest.bodyJsonUnsafe({ name: "Local authentication regression" }),
        ),
      );
      if (createWorkspaceResponse.status !== 201) {
        return yield* Effect.die(
          `Local authenticated Workspace creation returned ${createWorkspaceResponse.status}`,
        );
      }
    }).pipe(Effect.ensuring(stack.destroy().pipe(Effect.orDie)), Effect.orDie),
  { timeout: 120_000 },
);
