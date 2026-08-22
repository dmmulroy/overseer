import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Schema } from "effect";

import { OVERSEER_EMAIL_ALLOWLIST_ACCESS_POLICY_LOGICAL_ID } from "./overseer-shared-infrastructure-identifiers.ts";

const OverseerAccessAllowedEmail = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(320),
  Schema.isPattern(/^[^\s@]+@[^\s@]+$/),
);

const overseerAccessAllowedEmail = Config.schema(
  OverseerAccessAllowedEmail,
  "OVERSEER_ACCESS_ALLOWED_EMAIL",
);

/** Creates the account-wide Cloudflare Access policy for one configured email address. */
export const OverseerEmailAllowlistAccessPolicyResource = Effect.gen(function* () {
  const email = yield* overseerAccessAllowedEmail;

  return yield* Cloudflare.Access.Policy(OVERSEER_EMAIL_ALLOWLIST_ACCESS_POLICY_LOGICAL_ID, {
    decision: "allow",
    include: [{ email: { email } }],
    name: "Overseer email allowlist",
  });
});
