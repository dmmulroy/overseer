import { Schema } from "effect";
import { m } from "foldkit/message";

/** Request a typed REST echo. */
export const RequestedEcho = m("RequestedEcho", { value: Schema.NonEmptyString });
/** Record a successful typed REST echo. */
export const SucceededEcho = m("SucceededEcho", { value: Schema.String });
/** Record a failed typed REST echo. */
export const FailedEcho = m("FailedEcho", { message: Schema.String });
/** Record successful Project socket acquisition. */
export const ConnectedProjectSocket = m("ConnectedProjectSocket");
/** Record Project socket release. */
export const DisconnectedProjectSocket = m("DisconnectedProjectSocket");
/** Record failed Project socket acquisition. */
export const FailedProjectSocket = m("FailedProjectSocket", { message: Schema.String });

/** Messages accepted by the compatibility proof's Foldkit update function. */
export const ProjectMessage = Schema.Union([
  RequestedEcho,
  SucceededEcho,
  FailedEcho,
  ConnectedProjectSocket,
  DisconnectedProjectSocket,
  FailedProjectSocket,
]);

/** Runtime type of the compatibility proof's Foldkit messages. */
export type ProjectMessage = typeof ProjectMessage.Type;
