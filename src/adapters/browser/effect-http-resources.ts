import { FetchHttpClient } from "effect/unstable/http";
import {
  type Atom,
  AtomHttpApi,
  AtomRegistry,
} from "effect/unstable/reactivity";
import { OverseerApi } from "../../contract/http-api.ts";

/** Generated browser client and Atom runtime for Overseer's HTTP contract. */
export class OverseerHttpClient extends AtomHttpApi.Service<OverseerHttpClient>()(
  "@overseer/browser/OverseerHttpClient",
  {
    api: OverseerApi,
    httpClient: FetchHttpClient.layer,
  },
) {}

const discovery = OverseerHttpClient.query("discovery", "discover", {});

/** Current state of the generated discovery query. */
export type DiscoverySnapshot = Atom.Type<typeof discovery>;

/** Browser-owned discovery resources shared for the application lifetime. */
export type BrowserResources = {
  readonly getDiscovery: () => DiscoverySnapshot;
  readonly refreshDiscovery: () => void;
  readonly subscribeDiscovery: (notify: () => void) => () => void;
};

/** Construct the generated HTTP client resources owned by the browser root. */
export function makeBrowserResources(): BrowserResources {
  const registry = AtomRegistry.make();
  return {
    getDiscovery: () => registry.get(discovery),
    refreshDiscovery: () => registry.refresh(discovery),
    subscribeDiscovery: (notify) => registry.subscribe(discovery, notify),
  };
}
