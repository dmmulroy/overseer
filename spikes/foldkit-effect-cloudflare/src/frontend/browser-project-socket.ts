import { Effect } from "effect";
import {
  ProjectSocketOpenError,
  type OpenProjectSocket,
} from "./project-socket";

type BrowserSocket = Readonly<{
  addEventListener: (type: "open" | "error", listener: (event: Event) => void) => void;
  removeEventListener: (type: "open" | "error", listener: (event: Event) => void) => void;
  close: () => void;
}>;

type CreateBrowserSocket = (url: URL) => BrowserSocket;

/** Construct the browser adapter for Access-authenticated Project WebSockets. */
export function makeBrowserProjectSocket(
  origin: string,
  createSocket: CreateBrowserSocket = (url) => new WebSocket(url),
): OpenProjectSocket {
  return ({ projectId }) =>
    Effect.callback((resume) => {
      const url = new URL(`/projects/${encodeURIComponent(projectId)}/events`, origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

      // Cloudflare Access authenticates the browser's upgrade request with its
      // existing same-origin cookies; the WebSocket API cannot set headers.
      let socket: BrowserSocket;
      try {
        socket = createSocket(url);
      } catch (cause) {
        resume(Effect.fail(new ProjectSocketOpenError({
          message: "The Project socket could not be constructed.",
          cause,
        })));
        return Effect.void;
      }

      const removeListeners = (): void => {
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
      };
      const handleOpen = (): void => {
        removeListeners();
        resume(Effect.succeed({ close: () => socket.close() }));
      };
      const handleError = (cause: Event): void => {
        removeListeners();
        socket.close();
        resume(Effect.fail(new ProjectSocketOpenError({
          message: "The Project socket upgrade failed.",
          cause,
        })));
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);

      return Effect.sync(() => {
        removeListeners();
        socket.close();
      });
    });
}
