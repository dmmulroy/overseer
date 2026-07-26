import { DurableObject } from "cloudflare:workers";
import { WORKSPACE_REGISTRY_SINGLETON_NAME } from "../../src/application/workspace-registry/workspace-registry-rpc.ts";

type MigrationControlAction =
  | "poison"
  | "repair"
  | "corrupt-workspace"
  | "fail-second-insert"
  | "break-migration-body"
  | "repair-migration-body";

/** Test-only object that prepares, corrupts, or repairs persisted state before reconstruction. */
export class WorkspaceRegistryObject extends DurableObject {
  /** Execute one fixed test persistence-control action. */
  execute(action: MigrationControlAction): void {
    switch (action) {
      case "poison":
        this.ctx.storage.sql.exec("CREATE TABLE effect_sql_migrations (broken TEXT)");
        return;
      case "repair":
        this.ctx.storage.sql.exec("DROP TABLE effect_sql_migrations");
        return;
      case "corrupt-workspace":
        this.ctx.storage.sql.exec("UPDATE workspaces SET name = ''");
        return;
      case "fail-second-insert":
        this.ctx.storage.sql.exec(`CREATE TRIGGER fail_workspace_idempotency_insert
          BEFORE INSERT ON workspace_registry_idempotency
          WHEN NEW.idempotency_key = 'rollback-second-insert'
          BEGIN
            SELECT RAISE(ABORT, 'injected second insert failure');
          END`);
        return;
      case "break-migration-body":
        this.ctx.storage.sql.exec("CREATE TABLE workspaces (broken TEXT)");
        return;
      case "repair-migration-body":
        this.ctx.storage.sql.exec("DROP TABLE workspaces");
        return;
    }
  }
}

export default {
  /** Apply one persistence-control action to the production object's persisted name. */
  async fetch(
    request: Request,
    env: {
      readonly WorkspaceRegistryObject: DurableObjectNamespace<WorkspaceRegistryObject>;
    },
  ): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const action: MigrationControlAction =
      pathname === "/poison"
        ? "poison"
        : pathname === "/repair"
          ? "repair"
          : pathname === "/fail-second-insert"
            ? "fail-second-insert"
            : pathname === "/break-migration-body"
              ? "break-migration-body"
              : pathname === "/repair-migration-body"
                ? "repair-migration-body"
                : "corrupt-workspace";
    await env.WorkspaceRegistryObject.getByName(WORKSPACE_REGISTRY_SINGLETON_NAME).execute(action);
    return new Response("ok");
  },
};
