# Coding Standards

## Monorepo Boundaries

Treat every workspace under `apps/*` as an independent runnable or deployable composition root.
An app may depend on external packages and workspaces under `packages/*`; it must never import from,
declare a workspace dependency on, or reach through a relative source path into another app. This
rule applies to production code, scripts, and tests.

Workspaces under `packages/*` contain capabilities shared by apps and must not import from
`apps/*`. Cross-app behavior goes through a real runtime interface such as HTTP, or through a
shared package with an intentional public entrypoint. Cross-app end-to-end test support belongs in
a package rather than importing one app's internals into another app or its tests.

Keep code in its owning app while it has one consumer. When another app needs the same domain,
application service, adapter, infrastructure lifecycle, test utility, or client capability, move
that capability to a cohesive package and have both apps depend on it. Do not create a package
only to anticipate hypothetical reuse.

Apps should become thin entrypoints as shared capabilities emerge: retain process/runtime startup,
framework wiring, app-specific configuration, and final Layer or dependency composition in the
app; place reusable behavior behind package public entrypoints. This is an incremental direction,
not a requirement to relocate existing app-local modules before another owner needs them.

## Parse, Do Not Validate

Parse every value as soon as it crosses an I/O boundary. Treat HTTP, RPC, persistence,
configuration, files, queues, platform APIs, and third-party clients as sources of untrusted
external representations, even when TypeScript declarations claim otherwise.

Parsing must return a validated, meaningful domain or application type. Do not perform a boolean
validation check and then continue passing the original primitive, record, or transport type
inward. Encode constraints in schemas, branded types, smart constructors, and discriminated unions
so invalid states cannot enter inner modules.

Construct each schema parser once at module scope beside its owning schema instead of constructing
it inline at every boundary. Give the parser a domain-specific name and export it when other
boundaries parse the same representation:

```ts
export const parseCreateIssueCommand = Schema.decodeUnknownEffect(CreateIssueCommand);

const command = yield * parseCreateIssueCommand(requestBody);
return yield * issueService.createIssue(command);
```

Do not repeat inline constructions such as
`Schema.decodeUnknownEffect(CreateIssueCommand)(requestBody)`. Reuse the schema-owned parser so
callers share the same decoding behavior and can find every parse site by its domain-specific name.

The Adapter that owns the boundary owns this translation and its parse errors. Domain Modules and
Application Services accept parsed domain/application values and must not know about request
payloads, database rows, environment strings, vendor records, or other boundary representations.
When data leaves the application, encode rich values back into the exact external representation
required by that boundary.

## OpenAPI Contract Generation

Effect HTTP API contracts are the source of truth for checked-in OpenAPI specifications. Annotate the contract before generation; never hand-edit generated OpenAPI JSON.

- Add a safe, realistic schema example for every value a generated client must supply, especially branded IDs, names, request bodies, and lifecycle states. Never rely on importer placeholders such as `<string>`.
- Add concise operation summaries and descriptions that explain identifier provenance and request ordering. When one operation creates an ID used by another, say that the ID comes from the create response; clients can then use request chaining instead of persisting an instance-specific ID.
- Include representative success and public error examples for each operation state transition. Examples must conform to the same domain schema and stable error envelope that production serves.
- Declare every response correlation header, including error responses. `X-Overseer-Request-Id` is required on matched endpoint responses and its OpenAPI description must identify it as the support, log, and trace correlation ID.
- Document authentication schemes with their real header names and purpose. Verify a generated client import rather than assuming its authentication mapping is lossless.
- Add only truthful server URLs. A local server URL is appropriate when stable; do not invent a production hostname.
- Regenerate the specification with `vp run generate:openapi`, format it, and inspect the diff after every contract change.

## Schema Testing

Do not add tests that merely restate a schema's declared constraints with representative valid or
invalid values. Schema libraries own their decoding mechanics, and the schema declaration itself is
the specification for straightforward brands, structs, and unions.

Add schema-focused tests only when they verify application-owned behavior beyond the declaration,
such as a transformation, normalization, custom filter, compatibility contract, encoded/decoded
round trip, or a previously regressed edge case. Test boundary behavior through the boundary's
public interface when parsing failures produce caller-visible application or protocol outcomes.

## Optional Values

Represent every optional field, property, parameter, and return value with `Option.Option<A>`.

Do not represent optional values inside the application as `null`, `undefined`, `A | null`, `A | undefined`, or optional object properties. Decode nullable or optional external input into `Option` at the boundary, and encode it back only when an external contract requires `null`, `undefined`, or an omitted property.

```ts
import { Option } from "effect";

type Issue = {
  body: Option.Option<string>;
};

const withBody = Option.some("Issue details");
const withoutBody = Option.none<string>();
```

The `overseer/require-option-for-optional-values` lint rule enforces declaration surfaces in
`src/domain` and `src/application` (and `*.domain.ts` / `*.application.ts` modules). Boundary,
platform, generated, declaration, test, and fixture paths remain exempt because their contracts
may require nullish values; convert those values where they enter an inner module.

## Durable Object HTTP Boundary

Treat each Durable Object as an independent HTTP service with an Effect HTTP API exposed through
`fetch`.

- Do not use typed Alchemy RPC.
- Keep Durable Object bindings, namespaces, stubs, and `Cloudflare.toHttpClient` inside
  composition roots and client implementations.
- Expose only application-owned Effect client services such as `WorkspaceClient`, `ProjectClient`,
  and `IssueClient` to the rest of the application.
- Use the HTTP boundary to preserve the distinction between a Durable Object service and the Worker
  or other Durable Objects, even when Cloudflare executes the call within the same broader runtime
  environment.
- Treat this as a logical service boundary, not necessarily a physical network boundary.

### Client and Server Naming

Use the following names for the HTTP boundary:

```ts
interface IWorkspaceClient {
  readonly getWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<Option.Option<Workspace>, GetWorkspaceError>;
}

class WorkspaceClient extends Context.Service<WorkspaceClient, IWorkspaceClient>()(
  "@overseer/WorkspaceClient",
) {}

class WorkspaceServer extends Cloudflare.DurableObject<WorkspaceServer>()(
  "WorkspaceServer",
  workspaceServerImplementation,
) {}
```

- `IWorkspaceClient` is the application-facing client interface.
- `WorkspaceClient` is the contextual Effect service that implements the client capability.
- `WorkspaceServer` is the Alchemy Durable Object HTTP server.
- Apply the same convention to `ProjectServer`/`IProjectClient` and `IssueServer`/`IIssueClient`.
- Durable Object bindings, namespaces, and stubs remain implementation details of the client and
  server modules.
- Client constructors yield their corresponding Alchemy Durable Object service directly and close
  over its namespace. Do not introduce a hand-written namespace interface or pass a namespace into
  the constructor or Layer.

### Execution-Scoped Durable Object HTTP Clients

A Durable Object namespace may be resolved during Alchemy Init, but a stub and its generated HTTP
client must be constructed within the current Worker or Durable Object invocation. Never retain a
stub-backed client across invocation scopes: the canonical Durable Object ID selects the remote
instance, but it does not extend the caller-side Cloudflare I/O context.

Use Alchemy's execution memo together with an Effect `Cache` when one invocation may call multiple
Durable Object instances. The execution memo owns the request lifetime; the cache keys clients by
the canonical domain ID, joins concurrent first lookups, and reuses each generated client only
within that invocation. Use an unbounded cache because the invocation scope itself bounds its
lifetime. Suspend namespace lookup so Alchemy planning can construct the service without touching
a runtime-only binding:

```ts
const workspaceHttpClients =
  yield *
  makeExecutionMemo(
    Cache.make<WorkspaceId, WorkspaceHttpClient>({
      capacity: Number.POSITIVE_INFINITY,
      lookup: (id) =>
        Effect.suspend(() =>
          HttpApiClient.makeWith(WorkspaceHttpApi, {
            baseUrl: "http://workspace.internal",
            httpClient: Cloudflare.toHttpClient(namespace.getByName(id)),
          }),
        ),
    }),
  );
```

Keep keyed HTTP client selection private to the client constructor. Callers yield the contextual
application client and invoke domain operations with canonical IDs; they never select, retain, or
manage Durable Object stubs, generated HTTP clients, caches, or instance-bound facades. The
contextual service exposes only its application-facing interface:

```ts
class WorkspaceClient extends Context.Service<WorkspaceClient, IWorkspaceClient>()(
  "@overseer/WorkspaceClient",
) {}
```

The private client resolver reads the cache for the current invocation and ID. Public service
operations call that resolver internally before invoking the generated protocol client. Do not
expose this resolver through the service interface or as a static method on the service tag:

```ts
const workspaceHttpClient = (id: WorkspaceId) =>
  Effect.flatMap(workspaceHttpClients, (clients) => Cache.get(clients, id));
```

Use the same pattern without `Cache` when a client has exactly one fixed target per invocation:
`makeExecutionMemo` can memoize the single suspended client Effect directly. Do not substitute
`Layer.suspend`, `Layer.unwrap`, an isolate-scoped Layer, or a global cache; those lifetimes still
allow planning-time binding access or cross-invocation I/O reuse.

### Durable Object Identity

Every Durable Object instance must be keyed and accessed by its canonical domain ID.

- `WorkspaceServer` instances use `WorkspaceId`.
- `ProjectServer` instances use `ProjectId`.
- `IssueServer` instances use `IssueId`.
- Use the stable branded ID as the deterministic namespace key, never a display name or arbitrary
  caller-provided label.
- Client methods accept domain IDs; namespace lookup remains hidden inside the client implementation.

### Versioned HTTP Endpoints

- Every HTTP endpoint is versioned in its route, beginning with `/v1`.
- Request, response, error, and persistence schema names do not need a version suffix.
- Do not introduce unversioned aliases for versioned HTTP endpoints.

## Effect Imports

Import stable Effect modules as named namespace exports from the `effect` package root. Combine
multiple stable modules in one declaration:

```ts
import { Config, Effect } from "effect";
```

Import unstable modules as named namespace exports from their narrow public package entrypoint:

```ts
import { HttpServerResponse } from "effect/unstable/http";
```

Do not use direct leaf-module namespace imports such as `import * as Effect from "effect/Effect"`.
Use the same import form consistently in source files and tests.

## Error Design

Treat errors as product interfaces and observability data. Every error must explain what operation or outcome failed and give the most specific safe reason known. Tell the caller how to correct, retry, reconcile, or escalate the failure; provide reassurance only when the application can prove what was unaffected. Use calm, direct language without blame, jokes, generic fallback copy, or implementation jargon.

Carry diagnostic context as typed fields rather than burying it in prose. Include the operation, safe domain identifiers, a classified reason, recovery or retry information, and a public request identifier where applicable. Public errors use stable literal codes and variant-specific detail schemas. Internal errors retain richer safe context and causes for traces while public adapters redact secrets and implementation details.

Read [`docs/errors.md`](errors.md) before adding or changing typed errors, rendered error messages, public error schemas, HTTP error statuses, retry guidance, or failure telemetry. It is the source of truth for error principles, internal/public boundaries, contextual data, and the error review checklist.

## Effect Tagged Error Translation

Prefer `Effect.catchTag` or `Effect.catchTags` when translating an error channel whose expected
failures have `_tag` discriminants. List each known source error explicitly, preserve an
already-correct application error by failing with that same value, and translate each boundary
error according to its tag:

```ts
operation.pipe(
  Effect.catchTags({
    RegisterWorkspaceError: (error) => Effect.fail(error),
    SchemaError: () =>
      Effect.fail(
        new RegisterWorkspaceError({
          reason: "StoredDataInvalid",
          message: "Bookkeeper failed to register Workspace",
        }),
      ),
    SqlError: () =>
      Effect.fail(
        new RegisterWorkspaceError({
          reason: "PersistenceFailed",
          message: "Bookkeeper failed to register Workspace",
        }),
      ),
  }),
);
```

Do not use `instanceof` branches or a broad `Effect.mapError` to distinguish tagged expected
failures. Do not add a catch-all translation that silently classifies future error types. Leaving
an unhandled tag in the inferred error channel is intentional: a newly introduced failure must
produce a type error until its translation policy is chosen. `Effect.mapError` remains appropriate
when the complete error channel intentionally has one meaning and no tag-specific policy is being
lost.

When an `Effect.fn` whole-function transform is already a pipeable combinator, pass it directly.
Do not wrap it in `(effect) => effect.pipe(...)`:

```ts
const registerWorkspace = Effect.fn("BookkeeperClient.registerWorkspace")(
  function* (workspace: BookkeeperWorkspace) {
    return yield* client.registerWorkspace(workspace);
  },
  Effect.catchTags({
    RegisterWorkspaceError: (error) => Effect.fail(error),
    SchemaError: () => Effect.fail(new RegisterWorkspaceError({ reason: "StoredDataInvalid" })),
    HttpClientError: () => Effect.fail(new RegisterWorkspaceError({ reason: "PersistenceFailed" })),
  }),
);
```

Use a callback transform only when composing multiple combinators or when the transform needs the
original function arguments.

## Effect Service Dependencies in Layers

When a Layer or framework builder depends on a contextual Effect service, yield that service inside
the Effect that constructs the Layer's implementation. Keep the service in the Layer requirement
channel until the composition root selects its implementation with `Layer.provide`.

Export a Layer value with the dependency requirement instead of a factory that accepts the service
as a plain function argument:

```ts
/** Bookkeeper HTTP handlers backed by the contextual Bookkeeper database. */
export const bookkeeperHttpHandlersLayer = HttpApiBuilder.group(
  BookkeeperHttpApi,
  "bookkeeper",
  (handlers) =>
    Effect.gen(function* () {
      const database = yield* BookkeeperDatabase;

      return handlers.handle("getWorkspace", ({ params }) =>
        database.getWorkspace(params.workspaceId),
      );
    }),
);

const configuredBookkeeperHttpHandlersLayer = bookkeeperHttpHandlersLayer.pipe(
  Layer.provide(bookkeeperDatabaseLayer),
);
```

Do not manually yield a contextual service in an outer Effect solely to pass it into a
`make<CapabilityName>Layer(service)` function. Plain arguments remain appropriate for parsed request
or domain values, external constructor options, and capabilities whose behavior is genuinely
higher-order rather than an Effect service.

Tests follow the same requirement channel: provide a faithful implementation with `Layer.succeed`
or a test Layer, then provide that Layer to the dependency-preserving Layer under test.

## Effect Service Modules

Put each new Effect service in a file named for its capability. Keep the service declaration and
its construction in this order:

1. The service shape interface.
2. The contextual service class.
3. The service constructor.
4. The Layer that preserves dependency requirements.
5. The ready production Layer that provides production dependencies.
6. The ready test Layer that provides behaviorally faithful test dependencies.

Every exported symbol must include the capability name rather than relying on its file path for
context. Do not use `Tag` in symbol names. Name constructors `make<CapabilityName>` and use camel
case for Layer values.

A contextual service name does not have to end in `Service`. Use the shortest natural name for the
stable capability. `IssueService` is a sensible default when `Service` honestly describes a broad,
cohesive capability; a more specific established name such as `IssueStore` is preferable when it
better describes the authority. Apply the same chosen capability name consistently to its interface,
constructor, and Layers—for example, `IIssueStore`, `makeIssueStore`, `issueStoreLayer`, and
`issueStoreTestLayer`.

```ts
/** Defines the Issue service capability exposed to application callers. */
export interface IIssueService {
  readonly findIssue: (id: IssueId) => Effect.Effect<Issue, IssueNotFound>;
}

/** Provides the contextual Issue service capability. */
export class IssueService extends Context.Service<IssueService, IIssueService>()(
  "@overseer/IssueService",
) {}

/** Constructs the Issue service while preserving its dependency requirements. */
export const makeIssueService = Effect.gen(function* () {
  const issueStore = yield* IssueStore;

  return IssueService.of({
    findIssue: Effect.fn("IssueService.findIssue")(function* (id: IssueId) {
      return yield* issueStore.findIssue(id);
    }),
  });
});

/** Provides the Issue service without selecting dependency implementations. */
export const issueServiceLayerWithoutDependencies = Layer.effect(IssueService, makeIssueService);

/** Provides the Issue service with its production dependencies. */
export const issueServiceLayer = issueServiceLayerWithoutDependencies.pipe(
  Layer.provide(issueStoreLayer),
);

/** Provides the Issue service with behaviorally faithful test dependencies. */
export const issueServiceTestLayer = issueServiceLayerWithoutDependencies.pipe(
  Layer.provide(issueStoreTestLayer),
);
```

`<capabilityName>LayerWithoutDependencies` does not mean that the service has no dependencies. It
means the Layer leaves those requirements visible so callers or composition roots can provide
them. `<capabilityName>Layer` selects the complete production dependency graph. If the service has
no production dependencies, still export both canonical names and let the production Layer
reference the dependency-preserving Layer.

A `<capabilityName>TestLayer` must cross the same service interface as production and use complete,
behaviorally honest test implementations. Do not add partial mocks or weaken production behavior
solely to make the test Layer convenient.

## Comments and JSDoc

Every exported JavaScript or TypeScript symbol has JSDoc at its original declaration. A concise comment is sufficient when it states the sharpest caller-visible fact the signature cannot show. Use additional prose or tags only for further constraints, expected failures, side effects, ownership, invariants, trade-offs, non-obvious domain rules, or safety justifications.

Names, public documentation, UI copy, and rendered errors use durable vocabulary appropriate to their audience. Use ordinary domain phrases readers are likely to search for when those phrases differ from an identifier's spelling. Keep ticket names, migration phases, internal storage fields, framework mechanics, and planning language in internal implementation or planning material.

Public methods and properties of an exported class also require JSDoc. Document private/internal code when safe maintenance depends on a non-obvious purpose, invariant, domain rule, side effect, trade-off, or safety justification.

Document each original declaration once; re-exports rely on that documentation. Write explicit documentation in place of inheritance tags such as `@inheritDoc`.

Attach `/** ... */` JSDoc directly to its declaration. Include tags when they add caller-relevant information:

```ts
/**
 * Parse and validate an email address at an external input boundary.
 *
 * @param input - Raw input received from outside the application.
 * @returns A validated email address, or `InvalidEmailAddress` when validation fails.
 */
export function parseEmailAddress(input: string): Result<EmailAddress, InvalidEmailAddress>;
```

Add `@template` when a type parameter has a role or constraint the signature does not make clear:

```ts
/**
 * Map the success value of a result while preserving its error channel.
 *
 * @template E - Error channel preserved without invoking `fn`.
 * @param fn - Transforms the success value; it is skipped when `result` contains an error.
 * @returns A result containing the transformed success value or the original error.
 */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E>;
```

Reserve `@throws` for unrecoverable defects, framework-required behavior, and temporary `notYetImplemented` paths. Describe expected typed errors in `@returns` or the operation's documented outcomes.

Document exported object fields whose semantics extend beyond their names and types:

```ts
/** Options that bound and identify an outbound request. */
export type RequestOptions = {
  /** Total request budget, including connection setup and retries. */
  readonly timeout: Duration;

  /** Correlation identifier forwarded unchanged to downstream services. */
  readonly correlationId: CorrelationId;
};
```

## Symbol Names

Do not use the substring `shape` in symbol names. Matching is case-insensitive and intentionally
strict: any occurrence inside an identifier is prohibited, including names such as `Shape`,
`UserShape`, `shape`, and `shapeFactory`. The Oxlint rule applies to JavaScript and TypeScript
identifiers, private names, JSX names, declarations, references, and static member/property names.
It does not inspect string-literal property keys or comments because those are not symbol names.
The rule reports violations only; renaming cannot be autofixed safely because a JavaScript lint
plugin cannot guarantee that every declaration, reference, member access, export, and external API
contract is renamed consistently.
