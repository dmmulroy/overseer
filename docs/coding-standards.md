# Coding Standards

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
