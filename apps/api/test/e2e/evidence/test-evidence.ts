import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import {
  TestArtifactRef,
  type TestArtifactKind,
  type TestArtifactRef as TestArtifactRefValue,
} from "./test-artifact.ts";
import { TestEvidenceRecorder } from "./test-evidence-recorder.ts";
import { encodeTestEvidenceJson } from "./test-evidence-json.ts";
import type { TestExecutionId, TestRunId } from "./test-evidence-identity.ts";
import { TestRunStorage } from "./test-run-storage.ts";

/** Path or in-memory bytes copied into evidence storage. */
export type TestEvidenceSource =
  | { readonly _tag: "Path"; readonly path: string }
  | { readonly _tag: "Bytes"; readonly body: Uint8Array };

/** Generic file-like evidence attachment with an explicit media type. */
export interface TestEvidenceAttachment {
  readonly name: string;
  readonly contentType: string;
  readonly source: TestEvidenceSource;
}

/** File evidence supplied as a path or bytes, with extension inference for paths. */
export interface FileEvidenceAttachment {
  readonly name: string;
  readonly source: TestEvidenceSource;
  readonly contentType?: string;
}

/** Screenshot evidence supplied as a path or bytes and defaulting to PNG. */
export interface ScreenshotEvidenceAttachment {
  readonly name: string;
  readonly source: TestEvidenceSource;
  readonly contentType?: "image/png" | "image/jpeg";
}

/** Video path with inferred media type, or bytes with an explicit media type. */
export type VideoEvidenceAttachment =
  | {
      readonly name: string;
      readonly source: { readonly _tag: "Path"; readonly path: string };
      readonly contentType?: string;
    }
  | {
      readonly name: string;
      readonly source: { readonly _tag: "Bytes"; readonly body: Uint8Array };
      readonly contentType: string;
    };

/** UTF-8 text attached directly to the current test execution. */
export interface TextEvidenceAttachment {
  readonly name: string;
  readonly value: string;
}

/** Arbitrary diagnostic value encoded best-effort as JSON evidence. */
export interface JsonEvidenceAttachment<A> {
  readonly name: string;
  readonly value: A;
}

/** Operations that can fail while attaching test evidence. */
export const TestEvidenceOperation = Schema.Literals([
  "attach",
  "attachFile",
  "attachScreenshot",
  "attachVideo",
  "attachText",
  "attachJson",
]);

/** Name of one failed test evidence attachment operation. */
export type TestEvidenceOperation = typeof TestEvidenceOperation.Type;

/** Typed failure to read or persist one requested evidence attachment. */
export class TestEvidenceError extends Schema.TaggedError<TestEvidenceError>()(
  "TestEvidenceError",
  {
    operation: TestEvidenceOperation,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** Author-facing attachment capability scoped to one test execution. */
export interface ITestEvidence {
  readonly attach: (
    input: TestEvidenceAttachment,
  ) => Effect.Effect<TestArtifactRefValue, TestEvidenceError>;
  readonly attachFile: (
    input: FileEvidenceAttachment,
  ) => Effect.Effect<TestArtifactRefValue, TestEvidenceError>;
  readonly attachScreenshot: (
    input: ScreenshotEvidenceAttachment,
  ) => Effect.Effect<TestArtifactRefValue, TestEvidenceError>;
  readonly attachVideo: (
    input: VideoEvidenceAttachment,
  ) => Effect.Effect<TestArtifactRefValue, TestEvidenceError>;
  readonly attachText: (
    input: TextEvidenceAttachment,
  ) => Effect.Effect<TestArtifactRefValue, TestEvidenceError>;
  readonly attachJson: <A>(
    input: JsonEvidenceAttachment<A>,
  ) => Effect.Effect<TestArtifactRefValue, TestEvidenceError>;
}

/** Provides author-facing test evidence attachments for the current execution. */
export class TestEvidence extends Context.Service<TestEvidence, ITestEvidence>()(
  "@overseer/TestEvidence",
) {}

/** Run and execution identities required by the attachment capability. */
export interface TestEvidenceInput {
  /** Test run that owns every attached artifact. */
  readonly runId: TestRunId;
  /** Test execution that owns every attached artifact. */
  readonly testExecutionId: TestExecutionId;
}

const inferredContentType = (path: string): string => {
  switch (extname(path).toLowerCase()) {
    case ".json":
      return "application/json";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".txt":
    case ".log":
      return "text/plain; charset=utf-8";
    case ".webm":
      return "video/webm";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
};

const videoContentType = (attachment: VideoEvidenceAttachment): string =>
  attachment.source._tag === "Bytes"
    ? (attachment.contentType ?? "application/octet-stream")
    : (attachment.contentType ?? inferredContentType(attachment.source.path));

const readEvidenceSource = (
  source: TestEvidenceSource,
  operation: TestEvidenceOperation,
): Effect.Effect<Uint8Array, TestEvidenceError> =>
  source._tag === "Bytes"
    ? Effect.succeed(source.body.slice())
    : Effect.tryPromise({
        try: () => readFile(source.path),
        catch: (cause) =>
          new TestEvidenceError({
            operation,
            message: `Test evidence attachment failed while reading ${source.path}`,
            cause,
          }),
      });

/** Constructs attachments while preserving recorder and storage requirements. */
export const makeTestEvidence = (
  input: TestEvidenceInput,
): Effect.Effect<TestEvidence["Service"], never, TestEvidenceRecorder | TestRunStorage> =>
  Effect.gen(function* () {
    const recorder = yield* TestEvidenceRecorder;
    const storage = yield* TestRunStorage;

    const persistAttachment = Effect.fn("TestEvidence.persistAttachment")(function* (
      operation: TestEvidenceOperation,
      kind: TestArtifactKind,
      attachment: TestEvidenceAttachment,
    ) {
      if (attachment.name.trim().length === 0 || attachment.contentType.trim().length === 0) {
        return yield* Effect.fail(
          new TestEvidenceError({
            operation,
            message: "Test evidence attachment requires a nonempty name and content type",
            cause: attachment,
          }),
        );
      }
      const body = yield* readEvidenceSource(attachment.source, operation);
      const ref = TestArtifactRef.make({
        id: recorder.reserveArtifactId(),
        runId: input.runId,
        testExecutionId: input.testExecutionId,
        name: attachment.name,
        kind,
        contentType: attachment.contentType,
        byteLength: body.byteLength,
        createdAt: yield* DateTime.now,
      });
      const storedRef = yield* storage.createTestArtifact({ ref, body }).pipe(
        Effect.mapError(
          (cause) =>
            new TestEvidenceError({
              operation,
              message: `Test evidence attachment failed while storing ${attachment.name}`,
              cause,
            }),
        ),
      );
      recorder.appendArtifact(storedRef);
      return storedRef;
    });

    return TestEvidence.of({
      attach: (attachment) => persistAttachment("attach", "File", attachment),
      attachFile: (attachment) =>
        persistAttachment("attachFile", "File", {
          name: attachment.name,
          contentType:
            attachment.contentType ??
            (attachment.source._tag === "Path"
              ? inferredContentType(attachment.source.path)
              : "application/octet-stream"),
          source: attachment.source,
        }),
      attachScreenshot: (attachment) =>
        persistAttachment("attachScreenshot", "Screenshot", {
          name: attachment.name,
          contentType: attachment.contentType ?? "image/png",
          source: attachment.source,
        }),
      attachVideo: (attachment) =>
        persistAttachment("attachVideo", "Video", {
          name: attachment.name,
          contentType: videoContentType(attachment),
          source: attachment.source,
        }),
      attachText: (attachment) =>
        persistAttachment("attachText", "Text", {
          name: attachment.name,
          contentType: "text/plain; charset=utf-8",
          source: { _tag: "Bytes", body: new TextEncoder().encode(attachment.value) },
        }),
      attachJson: (attachment) =>
        persistAttachment("attachJson", "Json", {
          name: attachment.name,
          contentType: "application/json",
          source: {
            _tag: "Bytes",
            body: new TextEncoder().encode(
              `${JSON.stringify(encodeTestEvidenceJson(attachment.value), undefined, 2)}\n`,
            ),
          },
        }),
    });
  });

/** Provides attachments while leaving recorder and storage requirements visible. */
export const testEvidenceLayerWithoutDependencies = (
  input: TestEvidenceInput,
): Layer.Layer<TestEvidence, never, TestEvidenceRecorder | TestRunStorage> =>
  Layer.effect(TestEvidence, makeTestEvidence(input));
