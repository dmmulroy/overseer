/**
 * PROTOTYPE QUESTION
 *
 * Can Fate 1.3.2 sit behind an application-owned issue sync interface, preserve the
 * agent-facing REST contract, expose actionable optimistic-version conflicts, and
 * repair a detail plus filtered list after a realtime disconnect without silent loss?
 */
import assert from "node:assert/strict";
import { createAgentRestApi, type AgentRestApi } from "./agent-rest.js";
import { FateIssueSync } from "./fate-issue-sync.js";
import { IssueAuthority, type IssueSnapshot } from "./issue-authority.js";

const patchThroughRest = async (
  api: AgentRestApi,
  input: Readonly<{
    expectedVersion: number;
    id: string;
    state?: "closed" | "open";
    title?: string;
  }>,
): Promise<IssueSnapshot> => {
  const response = await api.fetch(
    new Request(`https://overseer.test/api/projects/prj_overseer/issues/${input.id}`, {
      body: JSON.stringify({ state: input.state, title: input.title }),
      headers: {
        "content-type": "application/json",
        "if-match": `"v${input.expectedVersion}"`,
      },
      method: "PATCH",
    }),
  );
  const body: unknown = await response.json();
  if (
    !response.ok ||
    !body ||
    typeof body !== "object" ||
    !("issue" in body) ||
    !body.issue ||
    typeof body.issue !== "object"
  ) {
    throw new Error("PROTOTYPE defect: external REST edit failed.");
  }

  // SAFETY: the Fetch adapter emitted an IssueSnapshot from the seeded authority.
  return body.issue as IssueSnapshot;
};

const main = async (): Promise<void> => {
  const issue: IssueSnapshot = {
    id: "iss_01",
    number: 1,
    state: "open",
    title: "Original title",
    version: 1,
  };
  const authority = new IssueAuthority([issue]);
  const api = createAgentRestApi(authority);
  const sync = new FateIssueSync(api);

  await sync.load(issue.id);
  assert.deepEqual(sync.openIssueIds(), [issue.id]);
  assert.deepEqual(sync.detail(issue.id), issue);

  const publicResponse = await api.fetch(
    new Request(`https://overseer.test/api/projects/prj_overseer/issues/${issue.id}`),
  );
  const publicBody = JSON.stringify(await publicResponse.json());
  assert.equal(publicBody.includes("__typename"), false);

  sync.disconnect();
  const remoteEdit = await patchThroughRest(api, {
    expectedVersion: 1,
    id: issue.id,
    title: "Remote title",
  });
  assert.equal(remoteEdit.version, 2);
  assert.equal(sync.detail(issue.id).title, "Original title");

  const conflictPromise = sync.editTitle({
    expectedVersion: 1,
    id: issue.id,
    title: "My stale title",
  });
  assert.equal(sync.detail(issue.id).title, "My stale title");

  const conflict = await conflictPromise;
  assert.equal(conflict._tag, "versionConflict");
  if (conflict._tag !== "versionConflict") {
    throw new Error("PROTOTYPE defect: expected a version conflict.");
  }
  assert.equal(conflict.expectedVersion, 1);
  assert.equal(conflict.actualVersion, 2);
  assert.equal(conflict.attempted.title, "My stale title");
  assert.equal(conflict.current.title, "Remote title");
  assert.equal(sync.detail(issue.id).title, "Remote title");
  assert.equal(sync.detail(issue.id).version, 2);

  const missedEdit = await patchThroughRest(api, {
    expectedVersion: 2,
    id: issue.id,
    state: "closed",
    title: "Closed elsewhere",
  });
  assert.equal(missedEdit.version, 3);
  assert.equal(sync.detail(issue.id).state, "open");
  assert.deepEqual(sync.openIssueIds(), [issue.id]);

  await sync.reconnect();
  assert.deepEqual(sync.detail(issue.id), missedEdit);
  assert.deepEqual(sync.openIssueIds(), []);
  sync.dispose();

  console.log(`
Fate 1.3.2 conflict/reconnect spike
====================================
PASS  Public issue list/detail/update remain ordinary REST JSON; Fate metadata stays in the adapter.
PASS  A stale optimistic edit is visible immediately, rolls back, and returns attempted plus current values and versions.
PASS  Reconnect authoritatively repairs both active detail data and filtered-list membership after a missed edit.
PASS  Feature-facing code depends on FateIssueSync rather than Fate types.
FAIL  Fate does not remove the application sync boundary: the custom Transport must own REST projection,
      conflict retyping, active-query tracking, reconnect detection, and authoritative refetch.

MVP verdict: NO-GO for Fate. Keep the application-owned REST/realtime sync module and omit Fate;
revisit if Fate gains a typed conflict envelope and a documented reconnect lifecycle/repair hook.
`);
};

await main();
