# Fixture Registry Planning

This is a collaborative design scratchpad for a composable mock-data and arbitrary registry. Nothing here is settled yet. In particular, this proposal revisits the current decisions in [`test-planning.md`](test-planning.md) that the harness supplies only `OverseerApiClient`, that no sampling service is justified, and that a generic fixture DSL remains deferred until the Workspace suite is green.

## Current idea

Introduce a registry of reusable test-data arbitraries. The registry would either:

1. be attached to `OverseerTestHarness` and made available to each registered test Effect; or
2. be passed explicitly into the test Effect by the harness registration API.

Working name:

```ts
FixtureRegistry;
```

The initial API sketch was model-oriented:

```ts
registry.models.workspace;
registry.models.project;
registry.models.issue;
```

Brad Frost's atomic design methodology is useful as inspiration for composing small parts into representative wholes, but the registry does not need to preserve its five-level hierarchy. The selected taxonomy has three groups:

```ts
registry.values...
registry.models...
registry.scenarios...
```

A model factory describes valid domain data at one point in time and may include relationships. A scenario factory describes the generated inputs for a representative multi-step situation or journey. For example, `workspace` is a model while `workspaceRename` is a scenario because it supplies distinct inputs for creation followed by rename.

## Brad Frost's atomic design language

Brad Frost defines five stages that work together rather than a linear five-step process:

1. **Atoms** — foundational elements that cannot be broken down further without losing their functional meaning.
2. **Molecules** — relatively simple groups of atoms functioning together as a unit.
3. **Organisms** — relatively complex assemblies of atoms, molecules, and possibly other organisms that form a distinct section.
4. **Templates** — page-level structures that arrange components and describe the underlying content structure without final representative content.
5. **Pages** — concrete instances of templates populated with representative content, including important variations that test whether the system is resilient.

Two aspects of Frost's framing appear especially relevant:

- The taxonomy makes the composition hierarchy inferable from names in a way that generic labels such as `elements`, `modules`, and `components` do not.
- The stages are a mental model for moving between parts and wholes, not a mandatory one-way construction pipeline.

Frost also explicitly says the taxonomy is not rigid dogma: a team should adapt it if different names communicate more effectively.

Source: Brad Frost, [Atomic Design, Chapter 2](https://atomicdesign.bradfrost.com/chapter-2/).

## Candidate registry shape

The smallest useful taxonomy may be:

| Registry group | Meaning                                                                                | Examples                                                                      |
| -------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Values**     | Factories for the smallest meaningful domain values                                    | `workspaceName`, `workspaceId`, `issueTitle`, `timestamp`, lifecycle state    |
| **Models**     | Factories for valid domain structures, including coherent relationships between models | `workspace`, `project`, `issue`, `projectWithIssues`, `workspaceWithProjects` |
| **Scenarios**  | Factories for inputs to representative multi-step situations or journeys               | `workspaceRename`, `projectTriage`, `issueReassignment`                       |

Possible shape:

```ts
interface FixtureValueFactory<A> {
  readonly make: () => A;
  readonly makeMany: (count: number) => ReadonlyArray<A>;
}

interface FixtureModelFactory<A> {
  readonly make: (overrides?: Readonly<Partial<A>>) => A;
  readonly makeMany: (count: number, overrides?: Readonly<Partial<A>>) => ReadonlyArray<A>;
}

interface FixtureScenarioFactory<A> {
  readonly make: (overrides?: Readonly<Partial<A>>) => A;
  readonly makeMany: (count: number, overrides?: Readonly<Partial<A>>) => ReadonlyArray<A>;
}

interface FixtureRegistry {
  readonly values: {
    readonly workspaceName: FixtureValueFactory<WorkspaceName>;
  };
  readonly models: {
    readonly workspace: FixtureModelFactory<Workspace>;
  };
  readonly scenarios: {
    readonly workspaceRename: FixtureScenarioFactory<WorkspaceRenameScenario>;
  };
}
```

The exact domain types and names above are illustrative; Project and Issue may not exist in the implementation yet.

### Why collapse the hierarchy?

- The registry needs discoverable generators, not a complete ontology of generated-data sizes.
- A valid relational structure is still part of the domain model; it does not necessarily need a separate noun.
- Parameterized arbitrary constructors can provide blueprint-like customization without a `blueprints` category.
- Scenarios earn a separate category because temporal or multi-step inputs are meaningfully different from domain data at one point in time.
- Additional categories should be introduced only when real entries become difficult to find or have meaningfully different behavior.

For example:

```ts
registry.models.projectWithIssues.make({
  issueCount: 3,
  issueStates: ["open", "in_progress", "closed"],
});

registry.models.firstTimeWorkspace.make();
registry.models.archivedWorkspace.makeMany(3);
registry.scenarios.workspaceRename.make();
```

The fixture factory owns deterministic arbitrary sampling. Tests consume only `make` and `makeMany`; they do not receive or sample the underlying arbitrary directly.

## Proposed framework wiring

The registry should remain an explicit test-authoring value, not an Effect service. Its isolated factories own deterministic in-memory generation cursors, but they have no authority over I/O, lifecycle, credentials, or runtime resources. A `FixtureRegistry` tag and Layer would add dependency-injection ceremony without a meaningful service seam.

Start with one module:

```text
apps/api/test/e2e/
├── fixture-registry.ts       # owns Workspace value/model factories and hidden arbitraries
├── overseer-test-harness.ts  # constructs registry and passes it to each test factory
└── workspace.ts              # consumes registry; owns API calls and assertions
```

Split domain-specific fixture modules only after more domains or consumers earn them:

```text
apps/api/test/e2e/fixtures/
├── fixture-registry.ts       # assembles domain registry fragments
├── workspace-fixtures.ts     # Workspace values, models, and scenarios
├── project-fixtures.ts       # Project values, models, and scenarios
└── issue-fixtures.ts         # Issue values, models, and scenarios
```

The harness keeps its existing runtime Layer for `OverseerApiClient`, yields the service internally, and passes both the client and fixture registry through the extensible callback context:

```ts
harness.test("a Workspace completes its persisted lifecycle", ({ client, fixtures }) =>
  Effect.gen(function* () {
    const { initialName, renamedName } = fixtures.scenarios.workspaceRename.make();

    // Drive the deployed public API and assert its observable behavior.
  }),
);
```

Conceptual registration signature:

```ts
interface OverseerTestContext {
  readonly client: IOverseerApiClient
  readonly fixtures: FixtureRegistry
}

test<E>(
  name: string,
  makeEffect: (
    context: OverseerTestContext,
  ) => Effect.Effect<void, E>,
  options?: OverseerTestOptions,
): void
```

Wiring:

```text
OverseerTestHarness.fromStack
├── configure Alchemy lifecycle
├── wait for deployment
│   └── construct OverseerApiClient Layer
└── harness.test(name, makeEffect)
    ├── construct an isolated FixtureRegistry
    ├── register with Alchemy Vitest
    └── at test execution
        ├── provide OverseerApiClient Layer
        ├── yield OverseerApiClient internally
        └── makeEffect({ client, fixtures })
```

This keeps the two dependency kinds honest:

```text
FixtureRegistry      explicit isolated value/model/scenario factories
client               callback value backed by OverseerApiClient
OverseerApiClient    internal Effect service with deployment and HTTP authority
```

If fixture creation later owns persistence, cleanup, or per-test mutable allocation, that new capability can earn an Effect service and scoped Layer. Until then, tests should materialize generated models through the existing `OverseerApiClient`; a fixture service that merely forwards to that client would not justify itself.

## Important semantic distinction

The words **arbitrary** and **fixture** may refer to different things:

- An **arbitrary** is a recipe for generating and shrinking values.
- A **fixture** is usually a concrete value, or a setup that acquires concrete state and may require teardown.

The implemented registry hides `Arbitrary<A>` behind fixture factories. `make` returns one deterministic value, while `makeMany` returns a deterministic sequence. Model factories accept typed field overrides. Neither operation persists data or owns teardown.

The current boundary is:

```text
fixture factory
  hides arbitrary composition and deterministic sampling
  returns in-memory values, models, and scenario inputs

test Effect
  creates persisted state through OverseerApiClient

test harness
  supplies runtime services and owns test/deployment lifecycle
```

This prevents fixture generation from silently acquiring infrastructure or hiding API calls.

## Desired properties

- **Schema-owned validity:** value arbitraries should derive from the schemas that own each domain value whenever possible.
- **Relational coherence:** model arbitraries must preserve IDs, ownership, lifecycle state, and other cross-model invariants by construction.
- **Determinism:** end-to-end tests should be reproducible from an explicit seed and sample index.
- **Readable failures:** generated values and reproduction information should be visible without logging secrets.
- **Overrideability:** tests should be able to constrain only the values relevant to the guarantee without reconstructing a complete graph.
- **Independence:** each test receives fresh values and does not depend on another test's mutations.
- **No false property semantics:** sampling mock data once for an end-to-end test does not turn that test into a property test and does not imply repeated runs or shrinking.
- **Public-boundary setup:** persisted fixtures should be created through the product's public test-driving surface unless a separately justified lower-level test owns a narrower boundary.

## Questions to settle collaboratively

1. **Where is the model/scenario boundary?** Relational data at one point in time remains a model; generated inputs representing temporal steps or a journey belong to scenarios.
2. **How are model variants named?** For example, `projectWithIssues`, `firstTimeWorkspace`, and `archivedWorkspace` may all live under `models`.
3. **Do all models and scenarios support shallow field overrides?** Relational invariants may eventually require narrower domain-specific override options.
4. **Who owns persistence and teardown?** The current answer is the test Effect using scoped public API operations; revisit only when repeated setup earns a separate capability.
5. **How should a failing run report its fixture seed and generation position?** Determinism exists now, but reproduction metadata is not yet surfaced as evidence.
6. **What next real test earns a new factory?** Grow the registry from actual Workspace, Project, and Issue guarantees rather than speculative entries.

## Suggested first design exercise

Use one concrete Workspace test to compare the smallest competing APIs:

```ts
harness.test("created workspace can be read", ({ client, fixtures }) =>
  Effect.gen(function* () {
    const workspaceName = fixtures.values.workspaceName.make();
    const workspace = fixtures.models.workspace.make({ name: workspaceName });
    // The test creates persisted state through the supplied authenticated client.
  }),
);
```

The Workspace rename scenario establishes the boundary: it supplies related inputs for sequential create and rename operations rather than one point-in-time domain model.
