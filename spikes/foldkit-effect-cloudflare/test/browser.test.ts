import { Effect, Option } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { Runtime, Scene } from "foldkit";
import * as Http from "foldkit/http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeBrowserProjectSocket } from "../src/frontend/browser-project-socket";
import { FetchEcho } from "../src/frontend/project-http";
import { makeProjectRuntime } from "../src/frontend/project-runtime";
import {
  ProjectModel,
  SocketConnecting,
} from "../src/frontend/project-state";
import { updateProject } from "../src/frontend/project-update";
import { projectView } from "../src/frontend/project-view";
import { SpikeApi } from "../src/shared-api";

const initialModel: ProjectModel = {
  activeProjectId: Option.some("project-spike"),
  socketState: SocketConnecting(),
  echoedValue: "",
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("Foldkit browser compatibility", () => {
  it("renders @foldkit/ui and exposes the typed HTTP Command through a Scene", () => {
    Scene.scene(
      { update: updateProject, view: projectView },
      Scene.with(initialModel),
      Scene.click(Scene.role("button", { name: "Run typed HTTP probe" })),
      Scene.Command.expectExact(FetchEcho),
      Scene.Command.resolve(FetchEcho, { _tag: "SucceededEcho", value: "foldkit" }),
      Scene.expect(Scene.text("echo=foldkit")).toExist(),
    );
  });

  it("runs a browser HttpApiClient Command derived from the Gateway contract", async () => {
    const requests: Array<Request> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return Response.json({ value: "from-shared-contract" });
    };

    const message = await Effect.runPromise(
      FetchEcho({ value: "foldkit" }).effect.pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      ),
    );

    expect(message).toEqual({
      _tag: "SucceededEcho",
      value: "from-shared-contract",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`${location.origin}/echo`);
    expect(requests[0]?.method).toBe("POST");
    await expect(requests[0]?.json()).resolves.toEqual({ value: "foldkit" });
  });

  it("decodes a declared Gateway error through the shared browser client", async () => {
    const fetch: typeof globalThis.fetch = async () => new Response(JSON.stringify({
      _tag: "DeclaredFailure",
      code: "declared_failure",
      message: "The declared failure was serialized.",
    }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });

    const failure = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* HttpApiClient.make(SpikeApi, {
          baseUrl: globalThis.location.origin,
        });
        return yield* Effect.flip(client.probe.declaredFailure());
      }).pipe(
        Effect.provide(Http.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      ),
    );
    expect(failure).toMatchObject({
      _tag: "DeclaredFailure",
      code: "declared_failure",
      message: "The declared failure was serialized.",
    });
  });

  it("acquires and releases a Project socket through Foldkit Managed Resources", async () => {
    let opened = 0;
    let closed = 0;
    const container = document.createElement("div");
    container.id = "project-runtime";
    document.body.append(container);

    const program = makeProjectRuntime(
      container,
      () => Effect.sync(() => {
        opened += 1;
        return { close: () => { closed += 1; } };
      }),
    );
    const handle = Runtime.embed(program);

    await vi.waitFor(() => expect(opened).toBe(1));
    handle.dispose();
    await vi.waitFor(() => expect(closed).toBe(1));
  });

  it("builds the same-origin Access-authenticated browser WebSocket URL", async () => {
    let openedUrl: URL | undefined;
    let closed = false;
    const listeners = new Map<string, (event: Event) => void>();
    const openProjectSocket = makeBrowserProjectSocket(
      "https://overseer.example",
      (url) => {
        openedUrl = url;
        queueMicrotask(() => listeners.get("open")?.(new Event("open")));
        return {
          addEventListener: (type, listener) => { listeners.set(type, listener); },
          removeEventListener: (type) => { listeners.delete(type); },
          close: () => { closed = true; },
        };
      },
    );

    const socket = await Effect.runPromise(
      openProjectSocket({ projectId: "project/with space" }),
    );

    expect(openedUrl?.toString()).toBe(
      "wss://overseer.example/projects/project%2Fwith%20space/events",
    );
    socket.close();
    expect(closed).toBe(true);
  });
});
