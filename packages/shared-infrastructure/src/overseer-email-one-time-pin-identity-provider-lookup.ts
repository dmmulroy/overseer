import * as Cloudflare from "alchemy/Cloudflare";

/** Looks up the externally managed account-wide email one-time PIN identity provider. */
export const OverseerEmailOneTimePinIdentityProviderLookup = Cloudflare.Access.getIdentityProvider({
  type: "onetimepin",
});
