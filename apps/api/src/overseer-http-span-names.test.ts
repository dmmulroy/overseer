import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpMiddleware,
  HttpServerRequest,
} from "effect/unstable/http";
import { overseerHttpSpanNameLayer } from "./overseer-http-span-names.ts";

it.effect("keeps Effect HTTP prefixes and appends normalized Overseer routes", () =>
  Effect.gen(function* () {
    const clientSpanName = yield* HttpClient.SpanNameGenerator;
    const serverSpanName = yield* HttpMiddleware.SpanNameGenerator;

    assert.strictEqual(
      clientSpanName(HttpClientRequest.post("https://overseer.test/v1/workspaces")),
      "http.client POST /v1/workspaces",
    );
    assert.strictEqual(
      serverSpanName(
        HttpServerRequest.fromWeb(
          new Request(
            "https://overseer.test/v1/workspaces/workspace_01KZGWRATYFXD8QCG7QTKG5C3S/rename?ignored=true",
            { method: "POST" },
          ),
        ),
      ),
      "http.server POST /v1/workspaces/:workspaceId/rename",
    );
    assert.strictEqual(
      clientSpanName(
        HttpClientRequest.put(
          "http://bookkeeper.internal/v1/projects/project_01KZGWRATYFXD8QCG7QTKG5C3S",
        ),
      ),
      "http.client PUT /v1/projects/:projectId",
    );
    assert.strictEqual(
      serverSpanName(
        HttpServerRequest.fromWeb(
          new Request("http://bookkeeper.internal/v1/issues/not-a-valid-id", {
            method: "DELETE",
          }),
        ),
      ),
      "http.server DELETE /v1/issues/:issueId",
    );
    assert.strictEqual(
      serverSpanName(HttpServerRequest.fromWeb(new Request("https://overseer.test/"))),
      "http.server GET /",
    );
  }).pipe(Effect.provide(overseerHttpSpanNameLayer)),
);
