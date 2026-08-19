import { Schema } from "effect";
import * as FastCheck from "effect/testing/FastCheck";
import {
  Workspace,
  type Workspace as WorkspaceModel,
  WorkspaceId,
  type WorkspaceId as WorkspaceIdValue,
  WorkspaceName,
  type WorkspaceName as WorkspaceNameValue,
  WorkspaceState,
  type WorkspaceState as WorkspaceStateValue,
} from "../../src/domain/workspace.ts";

const fixtureSampleSeed = 0x5eed;

const workspaceIdArbitrary = Schema.toArbitrary(WorkspaceId)(FastCheck);
const workspaceNameArbitrary = Schema.toArbitrary(WorkspaceName)(FastCheck);
const workspaceStateArbitrary = Schema.toArbitrary(WorkspaceState)(FastCheck);
const workspaceArbitrary = Schema.toArbitrary(Workspace)(FastCheck);

/** Generated inputs required to exercise a Workspace rename scenario. */
export interface WorkspaceRenameScenario {
  /** Valid name supplied when the Workspace is created. */
  readonly initialName: WorkspaceNameValue;
  /** Distinct valid name supplied when the Workspace is renamed. */
  readonly renamedName: WorkspaceNameValue;
}

const workspaceRenameArbitrary: FastCheck.Arbitrary<WorkspaceRenameScenario> = FastCheck.record({
  initialName: workspaceNameArbitrary,
  renamedName: workspaceNameArbitrary,
}).filter(({ initialName, renamedName }) => initialName !== renamedName);

/** Deterministically constructs generated values from one owning arbitrary. */
export interface FixtureValueFactory<A> {
  /** Constructs the next reproducible value. */
  readonly make: () => A;
  /** Constructs the requested number of reproducible values. */
  readonly makeMany: (count: number) => ReadonlyArray<A>;
}

/** Deterministically constructs generated models with optional typed field overrides. */
export interface FixtureModelFactory<A> {
  /** Constructs the next reproducible model and applies typed field overrides. */
  readonly make: (overrides?: Readonly<Partial<A>>) => A;
  /** Constructs reproducible models and applies the same typed field overrides to each. */
  readonly makeMany: (count: number, overrides?: Readonly<Partial<A>>) => ReadonlyArray<A>;
}

/** Deterministically constructs generated test scenarios with optional typed field overrides. */
export interface FixtureScenarioFactory<A> {
  /** Constructs the next reproducible scenario and applies typed field overrides. */
  readonly make: (overrides?: Readonly<Partial<A>>) => A;
  /** Constructs reproducible scenarios and applies the same typed field overrides to each. */
  readonly makeMany: (count: number, overrides?: Readonly<Partial<A>>) => ReadonlyArray<A>;
}

/** Smallest meaningful schema-derived values available to end-to-end tests. */
export interface FixtureRegistryValues {
  /** Canonical Workspace identity factory. */
  readonly workspaceId: FixtureValueFactory<WorkspaceIdValue>;
  /** Valid Workspace display-name factory. */
  readonly workspaceName: FixtureValueFactory<WorkspaceNameValue>;
  /** Valid Workspace lifecycle-state factory. */
  readonly workspaceState: FixtureValueFactory<WorkspaceStateValue>;
}

/** Valid standalone and relational models available to end-to-end tests. */
export interface FixtureRegistryModels {
  /** Canonical persisted Workspace model factory. */
  readonly workspace: FixtureModelFactory<WorkspaceModel>;
}

/** Multi-step test situations available to end-to-end tests. */
export interface FixtureRegistryScenarios {
  /** Distinct initial and replacement names required to rename a Workspace. */
  readonly workspaceRename: FixtureScenarioFactory<WorkspaceRenameScenario>;
}

/** Registry of deterministic schema-derived test value, model, and scenario factories. */
export interface FixtureRegistry {
  /** Smallest meaningful generated domain values. */
  readonly values: FixtureRegistryValues;
  /** Valid generated domain structures at useful test-authoring scales. */
  readonly models: FixtureRegistryModels;
  /** Generated inputs for representative multi-step test situations. */
  readonly scenarios: FixtureRegistryScenarios;
}

const makeFixtureSequence = <A>(arbitrary: FastCheck.Arbitrary<A>) => {
  let generatedCount = 0;

  return (count: number): ReadonlyArray<A> => {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("Fixture factory makeMany count must be a nonnegative safe integer");
    }

    const samples = FastCheck.sample(arbitrary, {
      numRuns: generatedCount + count,
      seed: fixtureSampleSeed,
    }).slice(generatedCount);
    generatedCount += count;
    return samples;
  };
};

const makeFixtureValueFactory = <A>(arbitrary: FastCheck.Arbitrary<A>): FixtureValueFactory<A> => {
  const makeMany = makeFixtureSequence(arbitrary);
  const make = (): A => {
    const value = makeMany(1)[0];
    if (value === undefined) {
      throw new Error("Fixture value factory returned no deterministic sample");
    }
    return value;
  };

  return { make, makeMany };
};

const makeOverridableFixtureFactory = <A>(
  arbitrary: FastCheck.Arbitrary<A>,
  applyOverrides: (generated: A, overrides?: Readonly<Partial<A>>) => A,
): FixtureModelFactory<A> & FixtureScenarioFactory<A> => {
  const makeSequence = makeFixtureSequence(arbitrary);
  const makeMany = (count: number, overrides?: Readonly<Partial<A>>): ReadonlyArray<A> =>
    makeSequence(count).map((generated) => applyOverrides(generated, overrides));
  const make = (overrides?: Readonly<Partial<A>>): A => {
    const model = makeMany(1, overrides)[0];
    if (model === undefined) {
      throw new Error("Fixture model factory returned no deterministic sample");
    }
    return model;
  };

  return { make, makeMany };
};

const applyWorkspaceOverrides = (
  generated: WorkspaceModel,
  overrides?: Readonly<Partial<WorkspaceModel>>,
): WorkspaceModel => ({ ...generated, ...overrides });

const applyWorkspaceRenameOverrides = (
  generated: WorkspaceRenameScenario,
  overrides?: Readonly<Partial<WorkspaceRenameScenario>>,
): WorkspaceRenameScenario => {
  const workspaceRename = { ...generated, ...overrides };
  if (workspaceRename.initialName === workspaceRename.renamedName) {
    throw new Error("Workspace rename scenario requires distinct initial and renamed names");
  }
  return workspaceRename;
};

/** Constructs an isolated fixture registry for one registered test. */
export const createFixtureRegistry = (): FixtureRegistry => ({
  values: {
    workspaceId: makeFixtureValueFactory(workspaceIdArbitrary),
    workspaceName: makeFixtureValueFactory(workspaceNameArbitrary),
    workspaceState: makeFixtureValueFactory(workspaceStateArbitrary),
  },
  models: {
    workspace: makeOverridableFixtureFactory(workspaceArbitrary, applyWorkspaceOverrides),
  },
  scenarios: {
    workspaceRename: makeOverridableFixtureFactory(
      workspaceRenameArbitrary,
      applyWorkspaceRenameOverrides,
    ),
  },
});
