import { Schema } from "effect";
import { TestArtifactId, TestExecutionId, TestRunId } from "./test-evidence-identity.ts";

/** Evidence artifact categories rendered by the test-run viewer. */
export const TestArtifactKind = Schema.Literals(["File", "Screenshot", "Video", "Text", "Json"]);

/** Category describing how an evidence artifact should be presented. */
export type TestArtifactKind = typeof TestArtifactKind.Type;

/** Persisted metadata that locates one test evidence artifact. */
export const TestArtifactRef = Schema.Struct({
  id: TestArtifactId,
  runId: TestRunId,
  testExecutionId: TestExecutionId,
  name: Schema.NonEmptyString,
  kind: TestArtifactKind,
  contentType: Schema.NonEmptyString,
  byteLength: Schema.Natural,
  createdAt: Schema.DateTimeUtcFromString,
});

/** Persisted reference to one test evidence artifact. */
export interface TestArtifactRef extends Schema.Schema.Type<typeof TestArtifactRef> {}

/** Bytes and metadata supplied when creating or replacing an evidence artifact. */
export interface TestArtifactWrite {
  /** Metadata identity and presentation fields persisted with the artifact. */
  readonly ref: TestArtifactRef;
  /** Complete artifact content copied before the write operation returns. */
  readonly body: Uint8Array;
}

/** Stored evidence artifact returned through the storage capability. */
export interface TestArtifact {
  /** Persisted artifact metadata. */
  readonly ref: TestArtifactRef;
  /** Complete stored artifact content. */
  readonly body: Uint8Array;
}
