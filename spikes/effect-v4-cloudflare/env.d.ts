import type { EffectSqliteDurableObject } from "./src/worker";

declare global {
  namespace Cloudflare {
    interface Env {
      readonly EFFECT_SQLITE_DO: DurableObjectNamespace<EffectSqliteDurableObject>;
    }
  }
}

export {};
