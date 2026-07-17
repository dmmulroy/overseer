import { Data, Effect } from "effect";

/** Input required to open a Project-scoped realtime connection. */
export type OpenProjectSocketInput = Readonly<{
  projectId: string;
}>;

/** Application-owned capability held by Foldkit's Managed Resource. */
export type ProjectSocket = Readonly<{
  close: () => void;
}>;

/** Expected failure while acquiring a Project socket. */
export class ProjectSocketOpenError extends Data.TaggedError("ProjectSocketOpenError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Application-owned socket factory implemented by a browser adapter. */
export type OpenProjectSocket = (
  input: OpenProjectSocketInput,
) => Effect.Effect<ProjectSocket, ProjectSocketOpenError>;
