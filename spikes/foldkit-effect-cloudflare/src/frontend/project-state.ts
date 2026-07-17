import { Schema } from "effect";
import { ts } from "foldkit/schema";

/** Project socket is inactive. */
export const SocketDisconnected = ts("SocketDisconnected");
/** Project socket is being acquired. */
export const SocketConnecting = ts("SocketConnecting");
/** Project socket is available. */
export const SocketConnected = ts("SocketConnected");
/** Project socket acquisition failed. */
export const SocketFailed = ts("SocketFailed", { message: Schema.String });

/** Transport-neutral Project socket state retained by the Foldkit Model. */
export const ProjectSocketState = Schema.Union([
  SocketDisconnected,
  SocketConnecting,
  SocketConnected,
  SocketFailed,
]);

/** Minimal transport-neutral Foldkit Model for the compatibility proof. */
export const ProjectModel = Schema.Struct({
  activeProjectId: Schema.Option(Schema.String),
  socketState: ProjectSocketState,
  echoedValue: Schema.String,
});

/** Runtime type of the minimal Foldkit Model. */
export type ProjectModel = typeof ProjectModel.Type;
