import * as Output from "alchemy/Output";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

/**
 * Creates the raw Overseer event lake and independently replaceable Workspace and Project
 * snapshot projections.
 */
export const OverseerEventDataLakeResources = Effect.gen(function* () {
  const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;

  const bucket = yield* Cloudflare.R2.Bucket("OverseerEventDataLakeBucket").pipe(
    RemovalPolicy.retain(),
  );

  const catalogToken = yield* Cloudflare.ApiToken.AccountApiToken("OverseerR2DataCatalogToken", {
    accountId,
    policies: [
      {
        effect: "allow",
        permissionGroups: ["Workers R2 Storage Write", "Workers R2 Data Catalog Write"],
        resources: {
          [`com.cloudflare.api.account.${accountId}`]: "*",
        },
      },
    ],
  });

  const catalog = yield* Cloudflare.R2.DataCatalog("OverseerEventDataCatalog", {
    bucketName: bucket.bucketName,
    compaction: {
      state: "enabled",
      targetSizeMb: "256",
    },
    token: catalogToken.value,
  });

  const stream = yield* Cloudflare.Pipelines.Stream("OverseerEventStream", {
    name: "overseer_event_stream",
    schema: {
      fields: [
        {
          name: "envelopeVersion",
          sqlName: "envelope_version",
          type: "int32",
          required: true,
        },
        {
          name: "eventId",
          sqlName: "event_id",
          type: "string",
          required: true,
        },
        { name: "source", type: "string", required: true },
        {
          name: "type",
          sqlName: "event_type",
          type: "string",
          required: true,
        },
        {
          name: "timestamp",
          sqlName: "event_timestamp",
          type: "timestamp",
          unit: "millisecond",
          required: true,
        },
        { name: "actor", type: "json", required: true },
        { name: "metadata", type: "json", required: true },
        { name: "payload", type: "json", required: true },
      ],
    },
    format: {
      type: "json",
      timestampFormat: "unix_millis",
    },
    http: { enabled: false },
    workerBinding: { enabled: true },
  });

  const rawEventsSink = yield* Cloudflare.Pipelines.Sink("OverseerRawEventsSink", {
    type: "r2_data_catalog",
    config: {
      bucket: catalog.bucketName,
      namespace: "overseer",
      tableName: "events",
      token: catalogToken.value,
      rollingPolicy: { intervalSeconds: 60 },
    },
    format: { type: "parquet", compression: "zstd" },
  });

  const workspaceSnapshotsSink = yield* Cloudflare.Pipelines.Sink(
    "OverseerWorkspaceSnapshotsSink",
    {
      type: "r2_data_catalog",
      config: {
        bucket: catalog.bucketName,
        namespace: "overseer",
        tableName: "workspace_snapshots",
        token: catalogToken.value,
        rollingPolicy: { intervalSeconds: 60 },
      },
      format: { type: "parquet", compression: "zstd" },
    },
  );

  const projectSnapshotsSink = yield* Cloudflare.Pipelines.Sink("OverseerProjectSnapshotsSink", {
    type: "r2_data_catalog",
    config: {
      bucket: catalog.bucketName,
      namespace: "overseer",
      tableName: "project_snapshots",
      token: catalogToken.value,
      rollingPolicy: { intervalSeconds: 60 },
    },
    format: { type: "parquet", compression: "zstd" },
  });

  const rawEventsPipeline = yield* Cloudflare.Pipelines.Pipeline("OverseerRawEventsPipeline", {
    sql: Output.interpolate`INSERT INTO ${rawEventsSink.name}
SELECT envelope_version, event_id, source, event_type, event_timestamp, actor, metadata, payload
FROM ${stream.name};`,
  });

  const workspaceSnapshotsPipeline = yield* Cloudflare.Pipelines.Pipeline(
    "OverseerWorkspaceSnapshotsPipeline",
    {
      sql: Output.interpolate`INSERT INTO ${workspaceSnapshotsSink.name}
SELECT
  event_id,
  event_type,
  event_timestamp,
  source,
  json_get_str(payload, 'workspace', 'workspaceId') AS workspace_id,
  json_get_str(payload, 'workspace', 'name') AS name,
  json_get_str(payload, 'workspace', 'state') AS state,
  to_timestamp_millis(json_get_str(payload, 'workspace', 'createdAt')) AS created_at,
  to_timestamp_millis(json_get_str(payload, 'workspace', 'updatedAt')) AS updated_at,
  json_get(payload, 'workspace', 'entityVersion')::BIGINT AS entity_version,
  event_type = 'workspace.delete.v1' AS is_deleted
FROM ${stream.name}
WHERE envelope_version = 1
  AND event_type IN (
    'workspace.create.v1',
    'workspace.rename.v1',
    'workspace.archive.v1',
    'workspace.unarchive.v1',
    'workspace.delete.v1'
  );`,
    },
  );

  const projectSnapshotsPipeline = yield* Cloudflare.Pipelines.Pipeline(
    "OverseerProjectSnapshotsPipeline",
    {
      sql: Output.interpolate`INSERT INTO ${projectSnapshotsSink.name}
SELECT
  event_id,
  event_type,
  event_timestamp,
  source,
  json_get_str(payload, 'project', 'projectId') AS project_id,
  json_get_str(payload, 'project', 'workspaceId') AS workspace_id,
  json_get_str(payload, 'project', 'name') AS name,
  json_get_str(payload, 'project', 'state') AS state,
  to_timestamp_millis(json_get_str(payload, 'project', 'createdAt')) AS created_at,
  to_timestamp_millis(json_get_str(payload, 'project', 'updatedAt')) AS updated_at,
  json_get(payload, 'project', 'entityVersion')::BIGINT AS entity_version,
  event_type = 'project.delete.v1' AS is_deleted
FROM ${stream.name}
WHERE envelope_version = 1
  AND event_type IN (
    'project.create.v1',
    'project.rename.v1',
    'project.archive.v1',
    'project.unarchive.v1',
    'project.delete.v1'
  );`,
    },
  );

  return {
    bucket,
    catalog,
    stream,
    rawEventsSink,
    rawEventsPipeline,
    workspaceSnapshotsSink,
    workspaceSnapshotsPipeline,
    projectSnapshotsSink,
    projectSnapshotsPipeline,
  };
});
