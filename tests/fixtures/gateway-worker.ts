import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { layer as accessAssertionVerifierLayer } from "../../src/adapters/gateway/access-principal.ts";
import {
  AccessAudience,
  ExactOrigin,
  GatewayConfiguration,
  HttpsOrigin,
} from "../../src/adapters/gateway/gateway-configuration.ts";
import {
  GatewayApplication,
  layer as gatewayApplicationLayer,
} from "../../src/adapters/gateway/gateway-application.ts";
import { layer as gatewayApiLayer } from "../../src/adapters/gateway/gateway-http.ts";
import {
  layer as problemResponseLayer,
  renderGatewayConfigurationUnavailable,
} from "../../src/adapters/gateway/problem-response.ts";
import {
  layer as ulidGeneratorLayer,
  UlidGeneratorService,
} from "../../src/application/ulid-generator.ts";
import { WorkspaceRegistryService } from "../../src/application/workspace-registry/workspace-registry.ts";
import {
  CreateProjectRpcInput,
  CreateWorkspaceRpcInput,
  IdempotencyKeyReused,
  ProjectNotFound,
  RenameProjectRpcInput,
  RenameWorkspaceRpcInput,
  WORKSPACE_REGISTRY_SINGLETON_NAME,
  WorkspaceNotFound,
  WorkspaceRegistryCursorInvalid,
  WorkspaceRegistryRecordCorrupt,
  WorkspaceRegistryRpcCallFailed,
  WorkspaceRegistryStateUnavailable,
  type WorkspaceRegistryRpc,
} from "../../src/application/workspace-registry/workspace-registry-rpc.ts";
import { makeRequestId } from "../../src/domain/actor.ts";
import { TestWorkspaceRegistry } from "./workspace-registry.ts";

export { TestWorkspaceRegistry };

const TestGatewayConfiguration = Schema.Struct({
  accessAudience: AccessAudience,
  accessIssuer: HttpsOrigin,
  allowedOrigin: ExactOrigin,
});

const ListWorkspacesFailure = Schema.Union([
  WorkspaceRegistryCursorInvalid,
  WorkspaceRegistryRecordCorrupt,
  WorkspaceRegistryStateUnavailable,
]);
const ReadWorkspaceFailure = Schema.Union([
  WorkspaceNotFound,
  WorkspaceRegistryRecordCorrupt,
  WorkspaceRegistryStateUnavailable,
]);
const CreateWorkspaceFailure = Schema.Union([
  IdempotencyKeyReused,
  WorkspaceRegistryRecordCorrupt,
  WorkspaceRegistryStateUnavailable,
]);
const RenameWorkspaceFailure = ReadWorkspaceFailure;
const ListProjectsFailure = Schema.Union([
  WorkspaceRegistryCursorInvalid,
  WorkspaceNotFound,
  WorkspaceRegistryRecordCorrupt,
  WorkspaceRegistryStateUnavailable,
]);
const ReadProjectFailure = Schema.Union([
  ProjectNotFound,
  WorkspaceRegistryRecordCorrupt,
  WorkspaceRegistryStateUnavailable,
]);
const CreateProjectFailure = Schema.Union([
  WorkspaceNotFound,
  IdempotencyKeyReused,
  WorkspaceRegistryRecordCorrupt,
  WorkspaceRegistryStateUnavailable,
]);

type EffectSuccess<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never;

type NativeWorkspaceRegistryStub = {
  readonly [K in keyof WorkspaceRegistryRpc]: (
    ...args: Parameters<WorkspaceRegistryRpc[K]>
  ) => Promise<EffectSuccess<ReturnType<WorkspaceRegistryRpc[K]>>>;
};

type WorkspaceRegistryNamespace = {
  readonly getByName: (name: string) => NativeWorkspaceRegistryStub;
};

type GatewayEnvironment = {
  readonly ASSETS?: { readonly fetch: (request: Request) => Promise<Response> };
  readonly WORKSPACE_REGISTRY: WorkspaceRegistryNamespace;
  readonly ACCESS_AUDIENCE: string;
  readonly ACCESS_ISSUER: string;
  readonly ALLOWED_ORIGIN: string;
};

let application: Promise<(request: Request) => Promise<Response>> | undefined;

function callFailed(operation: WorkspaceRegistryRpcCallFailed["operation"], cause: unknown) {
  return new WorkspaceRegistryRpcCallFailed({ operation, cause });
}

function makeHandler(
  configuration: typeof TestGatewayConfiguration.Type,
  workspaceRegistryNamespace: WorkspaceRegistryNamespace,
): Promise<(request: Request) => Promise<Response>> {
  const WorkspaceRegistryLive = Layer.effect(
    WorkspaceRegistryService,
    Effect.sync(() => {
      const stub = () => workspaceRegistryNamespace.getByName(WORKSPACE_REGISTRY_SINGLETON_NAME);
      return WorkspaceRegistryService.of({
        listWorkspaces: Effect.fn("TestWorkspaceRegistryRpc.listWorkspaces")((input) =>
          Effect.tryPromise({
            try: () =>
              stub().listWorkspaces(
                Option.match(input.cursor, {
                  onNone: () => ({ limit: input.limit }),
                  onSome: (cursor) => ({ cursor, limit: input.limit }),
                }),
              ),
            catch: (cause) => {
              const decoded = Schema.decodeUnknownResult(ListWorkspacesFailure)(cause);
              return Result.isSuccess(decoded)
                ? decoded.success
                : callFailed("listWorkspaces", cause);
            },
          }).pipe(
            Effect.map((page) => ({
              workspaces: page.workspaces,
              cursor: Option.fromNullishOr(page.cursor),
              nextCursor: Option.fromNullishOr(page.nextCursor),
              limit: page.limit,
            })),
          ),
        ),
        readWorkspace: Effect.fn("TestWorkspaceRegistryRpc.readWorkspace")((workspaceId) =>
          Effect.tryPromise({
            try: () => stub().readWorkspace(workspaceId),
            catch: (cause) => {
              const decoded = Schema.decodeUnknownResult(ReadWorkspaceFailure)(cause);
              return Result.isSuccess(decoded)
                ? decoded.success
                : callFailed("readWorkspace", cause);
            },
          }),
        ),
        createWorkspace: Effect.fn("TestWorkspaceRegistryRpc.createWorkspace")((input) =>
          Effect.tryPromise({
            try: () => stub().createWorkspace(CreateWorkspaceRpcInput.make(input)),
            catch: (cause) => {
              const decoded = Schema.decodeUnknownResult(CreateWorkspaceFailure)(cause);
              return Result.isSuccess(decoded)
                ? decoded.success
                : callFailed("createWorkspace", cause);
            },
          }),
        ),
        renameWorkspace: Effect.fn("TestWorkspaceRegistryRpc.renameWorkspace")(
          (workspaceId, name) =>
            Effect.tryPromise({
              try: () =>
                stub().renameWorkspace(RenameWorkspaceRpcInput.make({ workspaceId, name })),
              catch: (cause) => {
                const decoded = Schema.decodeUnknownResult(RenameWorkspaceFailure)(cause);
                return Result.isSuccess(decoded)
                  ? decoded.success
                  : callFailed("renameWorkspace", cause);
              },
            }),
        ),
        listProjects: Effect.fn("TestWorkspaceRegistryRpc.listProjects")((input) =>
          Effect.tryPromise({
            try: () =>
              stub().listProjects({
                ...(Option.isSome(input.workspaceId)
                  ? { workspaceId: input.workspaceId.value }
                  : {}),
                ...(Option.isSome(input.cursor) ? { cursor: input.cursor.value } : {}),
                limit: input.limit,
              }),
            catch: (cause) => {
              const decoded = Schema.decodeUnknownResult(ListProjectsFailure)(cause);
              return Result.isSuccess(decoded)
                ? decoded.success
                : callFailed("listProjects", cause);
            },
          }).pipe(
            Effect.map((page) => ({
              projects: page.projects,
              cursor: Option.fromNullishOr(page.cursor),
              nextCursor: Option.fromNullishOr(page.nextCursor),
              limit: page.limit,
            })),
          ),
        ),
        readProject: Effect.fn("TestWorkspaceRegistryRpc.readProject")((projectId) =>
          Effect.tryPromise({
            try: () => stub().readProject(projectId),
            catch: (cause) => {
              const decoded = Schema.decodeUnknownResult(ReadProjectFailure)(cause);
              return Result.isSuccess(decoded) ? decoded.success : callFailed("readProject", cause);
            },
          }),
        ),
        createProject: Effect.fn("TestWorkspaceRegistryRpc.createProject")((input) =>
          Effect.tryPromise({
            try: () => stub().createProject(CreateProjectRpcInput.make(input)),
            catch: (cause) => {
              const decoded = Schema.decodeUnknownResult(CreateProjectFailure)(cause);
              return Result.isSuccess(decoded)
                ? decoded.success
                : callFailed("createProject", cause);
            },
          }),
        ),
        renameProject: Effect.fn("TestWorkspaceRegistryRpc.renameProject")((projectId, name) =>
          Effect.tryPromise({
            try: () => stub().renameProject(RenameProjectRpcInput.make({ projectId, name })),
            catch: (cause) => {
              const decoded = Schema.decodeUnknownResult(ReadProjectFailure)(cause);
              return Result.isSuccess(decoded)
                ? decoded.success
                : callFailed("renameProject", cause);
            },
          }),
        ),
      });
    }),
  );
  const GatewayConfigurationLive = Layer.succeed(
    GatewayConfiguration,
    GatewayConfiguration.of({
      accessAudience: configuration.accessAudience,
      accessIssuer: configuration.accessIssuer,
      allowedOrigin: configuration.allowedOrigin,
      problemTypeBaseUrl: new URL("/problems/", configuration.allowedOrigin),
    }),
  );
  const ProblemResponseLive = problemResponseLayer.pipe(Layer.provide(GatewayConfigurationLive));
  const GatewayApiLive = gatewayApiLayer.pipe(
    Layer.provide([ProblemResponseLive, WorkspaceRegistryLive]),
  );
  const AccessVerifierLive = accessAssertionVerifierLayer.pipe(
    Layer.provide(GatewayConfigurationLive),
  );
  const ApplicationLive = gatewayApplicationLayer.pipe(
    Layer.provide([
      GatewayConfigurationLive,
      AccessVerifierLive,
      GatewayApiLive,
      ProblemResponseLive,
      ulidGeneratorLayer,
    ]),
  );
  const runtime = ManagedRuntime.make(ApplicationLive.pipe(Layer.provide(BrowserCrypto.layer)));

  return runtime
    .runPromise(GatewayApplication)
    .then((gateway) => HttpEffect.toWebHandler(gateway.fetch));
}

function unavailableResponse(): Promise<Response> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const ulids = yield* UlidGeneratorService;
      return renderGatewayConfigurationUnavailable(makeRequestId(yield* ulids.next())).pipe(
        HttpServerResponse.toWeb,
      );
    }).pipe(Effect.provide(ulidGeneratorLayer.pipe(Layer.provide(BrowserCrypto.layer)))),
  );
}

/** Raw workerd adapter used for fast HTTP and SQLite coverage in Miniflare. */
export default {
  async fetch(request: Request, env: GatewayEnvironment): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname !== "/api" && !pathname.startsWith("/api/")) {
      return env.ASSETS === undefined
        ? new Response("Application assets are unavailable", { status: 503 })
        : env.ASSETS.fetch(request);
    }

    const decoded = Schema.decodeUnknownResult(TestGatewayConfiguration)({
      accessAudience: env.ACCESS_AUDIENCE,
      accessIssuer: env.ACCESS_ISSUER,
      allowedOrigin: env.ALLOWED_ORIGIN,
    });

    if (Result.isFailure(decoded)) {
      return unavailableResponse();
    }

    application ??= makeHandler(decoded.success, env.WORKSPACE_REGISTRY);
    return (await application)(request);
  },
};
