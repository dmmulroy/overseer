import { Context, Effect, Layer } from "effect";
import {
  type IWorkspaceClient,
  WorkspaceClient,
  workspaceClientLayerWithoutDependencies,
} from "../durable-objects/workspaces/workspace-client.ts";

/** Resource clients exposed through the application-owned Overseer SDK. */
export interface IOverseerSdk {
  /** Operations for Workspace Durable Objects. */
  readonly workspace: IWorkspaceClient;
}

/** Provides the root application capability used by Overseer HTTP handlers. */
export class OverseerSdk extends Context.Service<OverseerSdk, IOverseerSdk>()(
  "@overseer/OverseerSdk",
) {}

/** Construct the Overseer SDK from its application client capabilities. */
export const makeOverseerSdk: Effect.Effect<OverseerSdk["Service"], never, WorkspaceClient> =
  Effect.gen(function* () {
    const workspace = yield* WorkspaceClient;

    return OverseerSdk.of({ workspace });
  });

/** Provides the Overseer SDK while leaving application client selection visible. */
export const overseerSdkLayerWithoutDependencies = Layer.effect(OverseerSdk, makeOverseerSdk);

/** Provides the Overseer SDK with its production application clients. */
export const overseerSdkLayer = overseerSdkLayerWithoutDependencies.pipe(
  Layer.provide(workspaceClientLayerWithoutDependencies),
);
