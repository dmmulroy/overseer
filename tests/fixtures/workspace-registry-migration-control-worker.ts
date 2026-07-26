import { DurableObject } from "cloudflare:workers";
import { WORKSPACE_REGISTRY_SINGLETON_NAME } from "../../src/application/workspace-registry/workspace-registry-rpc.ts";

type MigrationControlAction =
  | "poison"
  | "repair"
  | "corrupt-workspace"
  | "fail-creation-key-write"
  | "allow-creation-key-write"
  | "corrupt-creation-key"
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
      case "fail-creation-key-write":
        this.ctx.storage.sql.exec(`CREATE TRIGGER fail_creation_key_write
          BEFORE INSERT ON idempotency_keys
          WHEN NEW.idempotency_key = 'rollback-creation-key'
          BEGIN
            SELECT RAISE(ABORT, 'injected creation key write failure');
          END`);
        return;
      case "allow-creation-key-write":
        this.ctx.storage.sql.exec("DROP TRIGGER fail_creation_key_write");
        return;
      case "corrupt-creation-key":
        this.ctx.storage.sql.exec("PRAGMA foreign_keys = OFF");
        this.ctx.storage.sql.exec(`INSERT INTO idempotency_keys
          (idempotency_key, created_workspace_id, created_project_id)
          VALUES ('corrupt-creation-key', 'workspace_01J00000000000000000000000', NULL)`);
        this.ctx.storage.sql.exec("PRAGMA foreign_keys = ON");
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
          : pathname === "/fail-creation-key-write"
            ? "fail-creation-key-write"
            : pathname === "/allow-creation-key-write"
              ? "allow-creation-key-write"
              : pathname === "/corrupt-creation-key"
                ? "corrupt-creation-key"
                : pathname === "/break-migration-body"
                  ? "break-migration-body"
                  : pathname === "/repair-migration-body"
                    ? "repair-migration-body"
                    : "corrupt-workspace";
    await env.WorkspaceRegistryObject.getByName(WORKSPACE_REGISTRY_SINGLETON_NAME).execute(action);
    return new Response("ok");
  },
};
