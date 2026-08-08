import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Option, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const overseerOpenApiPath = new URL("../openapi.json", import.meta.url).pathname;

const YaakWorkspace = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

const YaakHttpRequest = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

const YaakEnvironment = Schema.Struct({
  id: Schema.String,
  base: Schema.Boolean,
  name: Schema.String,
});

const runYaakCommand = Effect.fn("runYaakCommand")(function* (arguments_: ReadonlyArray<string>) {
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* childProcessSpawner.string(ChildProcess.make("yaak", arguments_));
});

const parseYaakJson = <SchemaType extends Schema.Top>(
  schema: SchemaType,
  value: string,
  description: string,
) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(value).pipe(
    Effect.mapError(
      (cause) => new Error(`Yaak OpenAPI sync could not parse ${description}.`, { cause }),
    ),
  );

const parseYaakListIds = (output: string): ReadonlyArray<string> =>
  output
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.slice(0, line.indexOf(" - ")))
    .filter((id) => id.length > 0);

const listYaakWorkspaceIds = Effect.fn("listYaakWorkspaceIds")(function* () {
  return parseYaakListIds(yield* runYaakCommand(["workspace", "list"]));
});

const listYaakModelIds = Effect.fn("listYaakModelIds")(function* (
  workspaceId: string,
  model: "environment" | "request",
) {
  return parseYaakListIds(yield* runYaakCommand([model, "list", workspaceId]));
});

const loadYaakWorkspace = Effect.fn("loadYaakWorkspace")(function* (workspaceId: string) {
  const output = yield* runYaakCommand(["workspace", "show", workspaceId]);
  return yield* parseYaakJson(YaakWorkspace, output, `workspace ${workspaceId}`);
});

const loadYaakRequestsByName = Effect.fn("loadYaakRequestsByName")(function* (workspaceId: string) {
  const requestIds = yield* listYaakModelIds(workspaceId, "request");
  const requests = yield* Effect.forEach(requestIds, (requestId) =>
    runYaakCommand(["request", "show", requestId]).pipe(
      Effect.flatMap((output) => parseYaakJson(YaakHttpRequest, output, `request ${requestId}`)),
    ),
  );
  return new Map(requests.map((request) => [request.name, request] as const));
});

const requireYaakRequest = <Request>(
  requestsByName: ReadonlyMap<string, Request>,
  requestName: string,
) =>
  Option.fromNullishOr(requestsByName.get(requestName)).pipe(
    Effect.fromOption(
      () => new Error(`Yaak OpenAPI sync could not find request named "${requestName}".`),
    ),
  );

const updateYaakRequest = Effect.fn("updateYaakRequest")(function* (
  requestId: string,
  patch: object,
) {
  yield* runYaakCommand(["request", "update", JSON.stringify({ id: requestId, ...patch })]);
});

const syncYaakOpenApi = Effect.fn("syncYaakOpenApi")(function* () {
  const previousWorkspaceIds = yield* listYaakWorkspaceIds();
  const previousWorkspaceIdSet = new Set(previousWorkspaceIds);

  yield* runYaakCommand(["import", overseerOpenApiPath]);

  const importedWorkspaceIds = (yield* listYaakWorkspaceIds()).filter(
    (workspaceId) => !previousWorkspaceIdSet.has(workspaceId),
  );
  if (importedWorkspaceIds.length !== 1) {
    return yield* Effect.fail(
      new Error(
        `Yaak OpenAPI sync expected one imported workspace but found ${importedWorkspaceIds.length}.`,
      ),
    );
  }
  const workspaceId = yield* Option.fromNullishOr(importedWorkspaceIds[0]).pipe(
    Effect.fromOption(
      () => new Error("Yaak OpenAPI sync could not identify the imported workspace."),
    ),
  );
  const importedWorkspace = yield* loadYaakWorkspace(workspaceId);
  if (importedWorkspace.name !== "Overseer API") {
    return yield* Effect.fail(
      new Error(`Yaak OpenAPI sync imported unexpected workspace "${importedWorkspace.name}".`),
    );
  }

  const requestsByName = yield* loadYaakRequestsByName(workspaceId);
  const createWorkspaceRequest = yield* requireYaakRequest(requestsByName, "Create Workspace");
  const workspaceIdFromCreateResponse = `\${[ response.body.path(request='${createWorkspaceRequest.id}', behavior='smart', ttl='0', result='first', join=b64'LCA', path=b64'JC5pZA') ]}`;
  const cloudflareAccessAuthentication = {
    key: "Cf-Access-Jwt-Assertion",
    location: "header",
    value: "${[accessAssertion]}",
  };

  yield* Effect.forEach(requestsByName.values(), (request) =>
    updateYaakRequest(request.id, {
      authenticationType: "apikey",
      authentication: cloudflareAccessAuthentication,
    }),
  );

  yield* updateYaakRequest(createWorkspaceRequest.id, {
    body: { text: '{\n  "name": "Product Engineering"\n}' },
  });
  const renameWorkspaceRequest = yield* requireYaakRequest(requestsByName, "Rename Workspace");
  yield* updateYaakRequest(renameWorkspaceRequest.id, {
    body: { text: '{\n  "name": "Platform Engineering"\n}' },
  });

  yield* Effect.forEach(
    ["Get Workspace", "Rename Workspace", "Archive Workspace", "Unarchive Workspace"],
    (requestName) =>
      Effect.gen(function* () {
        const request = yield* requireYaakRequest(requestsByName, requestName);
        yield* updateYaakRequest(request.id, {
          urlParameters: [
            {
              enabled: true,
              id: null,
              name: ":workspaceId",
              value: workspaceIdFromCreateResponse,
            },
          ],
        });
      }),
  );

  const environmentIds = yield* listYaakModelIds(workspaceId, "environment");
  const environments = yield* Effect.forEach(environmentIds, (environmentId) =>
    runYaakCommand(["environment", "show", environmentId]).pipe(
      Effect.flatMap((output) =>
        parseYaakJson(YaakEnvironment, output, `environment ${environmentId}`),
      ),
    ),
  );
  const baseEnvironment = yield* Option.fromNullishOr(
    environments.find((environment) => environment.base),
  ).pipe(
    Effect.fromOption(
      () => new Error("Yaak OpenAPI sync could not find the imported base environment."),
    ),
  );

  yield* runYaakCommand([
    "environment",
    "update",
    JSON.stringify({
      id: baseEnvironment.id,
      name: "Local",
      variables: [
        { enabled: true, id: null, name: "baseUrl", value: "http://localhost:8787" },
        { enabled: true, id: null, name: "accessAssertion", value: "local" },
      ],
    }),
  ]);

  const previousOverseerWorkspaceIds = yield* Effect.filter(
    previousWorkspaceIds,
    (previousWorkspaceId) =>
      loadYaakWorkspace(previousWorkspaceId).pipe(
        Effect.map((workspace) => workspace.name === "Overseer API"),
      ),
  );
  yield* Effect.forEach(previousOverseerWorkspaceIds, (previousWorkspaceId) =>
    runYaakCommand(["workspace", "delete", previousWorkspaceId, "--yes"]),
  );

  yield* Effect.logInfo(`Synced Overseer OpenAPI into Yaak workspace ${workspaceId}.`);
});

NodeRuntime.runMain(syncYaakOpenApi().pipe(Effect.provide(NodeServices.layer)));
