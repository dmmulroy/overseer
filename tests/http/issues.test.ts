import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Miniflare } from "miniflare";
import {
  IssueReferenceCollection,
  IssueResponse,
  IssueRevisionCollection,
  IssueTimelineCollection,
  ProjectResponse,
  WorkspaceResponse,
} from "../../src/contract/http-api.ts";
import { startGateway } from "../fixtures/gateway.ts";

const issuer = "https://overseer-issues.cloudflareaccess.com";
const audience = "overseer-issues-audience";
const origin = "https://overseer.test";
let gateway: Miniflare;
let privateKey: CryptoKey;
let projectId: string;

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);
  gateway = await startGateway({
    accessAudience: audience,
    accessIssuer: issuer,
    accessJwks: JSON.stringify({ keys: [{ ...publicJwk, alg: "RS256", kid: "issues" }] }),
    allowedOrigin: origin,
  });
  const workspace = Schema.decodeUnknownSync(WorkspaceResponse)(
    await (
      await api("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "issue-workspace" },
        body: JSON.stringify({ name: "Issue Workspace" }),
      })
    ).json(),
  );
  projectId = Schema.decodeUnknownSync(ProjectResponse)(
    await (
      await api(`/api/workspaces/${workspace.id}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "issue-project" },
        body: JSON.stringify({ name: "Issue Project" }),
      })
    ).json(),
  ).id;
});

afterAll(async () => gateway?.dispose());

async function humanAssertion(): Promise<string> {
  return new SignJWT({ email: "owner@example.com", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "issues", typ: "JWT" })
    .setAudience(audience)
    .setIssuer(issuer)
    .setSubject("issue-human")
    .setIssuedAt()
    .setExpirationTime("5 minutes")
    .sign(privateKey);
}
async function agentAssertion(): Promise<string> {
  return new SignJWT({ common_name: "issue-agent.access", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "issues", typ: "JWT" })
    .setAudience(audience)
    .setIssuer(issuer)
    .setSubject("")
    .setIssuedAt()
    .setExpirationTime("5 minutes")
    .sign(privateKey);
}
async function api(
  path: string,
  init: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  } = {},
) {
  return gateway.dispatchFetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      "cf-access-jwt-assertion": await humanAssertion(),
      ...(init.method === undefined || init.method === "GET" || init.method === "HEAD"
        ? {}
        : { origin }),
    },
  });
}
async function createIssue(title: string, key: string, body?: string) {
  return api(`/api/projects/${projectId}/issues`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ title, ...(body === undefined ? {} : { body }) }),
  });
}

describe("Issue REST interface", () => {
  it("atomically creates numbered Issues and returns one representation through both reads", async () => {
    const created = await createIssue(
      "First numbered Issue",
      "issue-first",
      "Initial **Markdown** body",
    );
    expect(created.status).toBe(201);
    const issue = Schema.decodeUnknownSync(IssueResponse)(await created.json());
    expect(issue).toMatchObject({
      id: expect.stringMatching(/^issue_[0-9A-HJKMNP-TV-Z]{26}$/),
      project_id: projectId,
      number: 1,
      title: "First numbered Issue",
      body: "Initial **Markdown** body",
      state: "open",
      links: { self: { href: expect.stringMatching(/^\/api\/issues\/issue_/) } },
    });
    expect(created.headers.get("location")).toBe(issue.links.self?.href);

    const canonical = await api(`/api/issues/${issue.id}`);
    const numbered = await api(`/api/projects/${projectId}/issues/1`);
    expect(await canonical.json()).toEqual(issue);
    expect(await numbered.json()).toEqual(issue);
    for (const noncanonicalNumber of ["01", "+1", "1.0", "1e0"]) {
      expect((await api(`/api/projects/${projectId}/issues/${noncanonicalNumber}`)).status).toBe(
        400,
      );
    }

    const revisions = Schema.decodeUnknownSync(IssueRevisionCollection)(
      await (await api(`/api/issues/${issue.id}/revisions`)).json(),
    );
    expect(revisions.items).toMatchObject([
      {
        field: "body",
        number: 1,
        value: "Initial **Markdown** body",
        actor: { kind: "human", subject: "issue-human" },
      },
      {
        field: "title",
        number: 1,
        value: "First numbered Issue",
        actor: { kind: "human", subject: "issue-human" },
      },
    ]);
    const timeline = Schema.decodeUnknownSync(IssueTimelineCollection)(
      await (await api(`/api/issues/${issue.id}/timeline`)).json(),
    );
    expect(timeline.items).toMatchObject([
      {
        position: 1,
        event: { kind: "issue_created", source_issue_id: issue.id, actor: { kind: "human" } },
      },
    ]);
  });

  it("serializes concurrent allocation and replays one object-local creation key", async () => {
    const [first, replay] = await Promise.all([
      createIssue("Concurrent original", "issue-concurrent-key"),
      createIssue("Concurrent changed body", "issue-concurrent-key"),
    ]);
    expect([first.status, replay.status]).toEqual([201, 201]);
    const firstIssue = Schema.decodeUnknownSync(IssueResponse)(await first.json());
    const replayIssue = Schema.decodeUnknownSync(IssueResponse)(await replay.json());
    expect(replayIssue.id).toBe(firstIssue.id);
    expect([
      first.headers.get("idempotency-replayed"),
      replay.headers.get("idempotency-replayed"),
    ]).toContain("true");

    const next = Schema.decodeUnknownSync(IssueResponse)(
      await (await createIssue("Next monotonic Issue", "issue-next")).json(),
    );
    expect(next.number).toBe(firstIssue.number + 1);
  });

  it("captures Agent/session attribution immutably", async () => {
    const response = await gateway.dispatchFetch(`${origin}/api/projects/${projectId}/issues`, {
      method: "POST",
      headers: {
        "cf-access-jwt-assertion": await agentAssertion(),
        "content-type": "application/json",
        "idempotency-key": "issue-agent",
        "overseer-session-id": "session-58",
        "overseer-harness": "pi",
      },
      body: JSON.stringify({ title: "Agent-created Issue" }),
    });
    const issue = Schema.decodeUnknownSync(IssueResponse)(await response.json());
    const timeline = Schema.decodeUnknownSync(IssueTimelineCollection)(
      await (await api(`/api/issues/${issue.id}/timeline`)).json(),
    );
    expect(timeline.items[0]).toMatchObject({
      event: {
        actor: { kind: "agent", agent_id: "issue-agent.access" },
        agent_session: { session_id: "session-58", harness: "pi" },
      },
    });
  });

  it("reconciles resolvable same-Project mentions atomically and leaves unresolved qualified text literal", async () => {
    const target = Schema.decodeUnknownSync(IssueResponse)(
      await (await createIssue("Mention target", "issue-mention-target")).json(),
    );
    const source = Schema.decodeUnknownSync(IssueResponse)(
      await (
        await createIssue(
          "Mention source",
          "issue-mention-source",
          `Links #${target.number} and https://overseer.test/api/issues/${target.id}.\n\n~~~md\n#9999\n~~~\n\n\`\`#7777\`\`\n\n    #6666\n\nEscaped \\#8888 and project_01J00000000000000000000000#77.`,
        )
      ).json(),
    );
    const sourceReferences = Schema.decodeUnknownSync(IssueReferenceCollection)(
      await (await api(`/api/issues/${source.id}/references`)).json(),
    );
    const targetReferences = Schema.decodeUnknownSync(IssueReferenceCollection)(
      await (await api(`/api/issues/${target.id}/references`)).json(),
    );
    expect(sourceReferences.outgoing).toEqual([
      { source_issue_id: source.id, target_issue_id: target.id },
    ]);
    expect(targetReferences.incoming).toEqual(sourceReferences.outgoing);
    const sourceTimeline = Schema.decodeUnknownSync(IssueTimelineCollection)(
      await (await api(`/api/issues/${source.id}/timeline`)).json(),
    );
    const targetTimeline = Schema.decodeUnknownSync(IssueTimelineCollection)(
      await (await api(`/api/issues/${target.id}/timeline`)).json(),
    );
    const sourceReferenceEvent = sourceTimeline.items.find(
      (entry) => entry.event.kind === "internal_reference_added",
    );
    const targetReferenceEvent = targetTimeline.items.find(
      (entry) => entry.event.kind === "internal_reference_added",
    );
    expect(sourceReferenceEvent?.event.id).toBe(targetReferenceEvent?.event.id);
  });
});
