/**
 * End-to-end integration tests with real Rust CLI
 * 
 * These tests require:
 * - Rust CLI built at ../../os/target/debug/os
 * - jj repository initialized in test directory
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

let testDir: string;
let originalDbPath: string | undefined;
let originalCliPath: string | undefined;
let originalCliCwd: string | undefined;

before(async () => {
  // Create temporary directory for test database
  testDir = await mkdtemp(join(tmpdir(), "overseer-test-"));
  const dbPath = join(testDir, "overseer.db");
  
  // Set DB path, CLI path, and CWD for tests
  originalDbPath = process.env.OVERSEER_DB_PATH;
  originalCliPath = process.env.OVERSEER_CLI_PATH;
  originalCliCwd = process.env.OVERSEER_CLI_CWD;
  process.env.OVERSEER_DB_PATH = dbPath;
  // Point to debug binary (relative to mcp directory)
  process.env.OVERSEER_CLI_PATH = join(process.cwd(), "../overseer/target/debug/os");
  // Run CLI from test directory (where jj repo is)
  process.env.OVERSEER_CLI_CWD = testDir;

  // Initialize jj repo for VCS tests
  await runCommand("jj", ["git", "init", "--colocate", testDir]);
  await runCommand("jj", ["describe", "-m", "initial"], testDir);
});

after(async () => {
  // Restore original env vars
  if (originalDbPath === undefined) {
    delete process.env.OVERSEER_DB_PATH;
  } else {
    process.env.OVERSEER_DB_PATH = originalDbPath;
  }
  
  if (originalCliPath === undefined) {
    delete process.env.OVERSEER_CLI_PATH;
  } else {
    process.env.OVERSEER_CLI_PATH = originalCliPath;
  }
  
  if (originalCliCwd === undefined) {
    delete process.env.OVERSEER_CLI_CWD;
  } else {
    process.env.OVERSEER_CLI_CWD = originalCliCwd;
  }

  // Clean up test directory
  if (testDir) {
    await rm(testDir, { recursive: true, force: true });
  }
});

/**
 * Helper to run shell commands
 */
function runCommand(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: cwd || testDir });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed: ${stderr || stdout}`));
      }
    });
  });
}

/**
 * Helper to execute code via executor directly
 */
async function executeCode(code: string): Promise<unknown> {
  // Import execute directly to avoid MCP connection requirement
  const { execute } = await import("../executor.js");
  return await execute(code);
}

describe("Integration Tests", () => {
  describe("Tasks API", () => {
    it("should create and get task", async () => {
      const result = await executeCode(`
        const task = await tasks.create({
          description: "Test task",
          context: "Test context",
          priority: 1
        });
        return task;
      `);

      assert.ok(result);
      const task = result as Record<string, unknown>;
      assert.ok(task.id);
      assert.equal(task.description, "Test task");
      assert.equal(task.priority, 1);
      assert.equal(task.completed, false);
      assert.equal(task.depth, 0);
    });

    it("should list tasks", async () => {
      // Create a task first
      await executeCode(`
        await tasks.create({ description: "List test task" });
      `);

      const result = await executeCode(`
        return await tasks.list();
      `);

      assert.ok(Array.isArray(result));
      assert.ok((result as unknown[]).length > 0);
    });

    it("should create parent-child hierarchy", async () => {
      const result = await executeCode(`
        const parent = await tasks.create({
          description: "Parent task",
          priority: 1
        });
        
        const child = await tasks.create({
          description: "Child task",
          parentId: parent.id,
          priority: 2
        });
        
        return { parent, child };
      `);

      assert.ok(result);
      const { parent, child } = result as Record<
        string,
        Record<string, unknown>
      >;
      assert.equal(parent.depth, 0);
      assert.equal(child.depth, 1);
      assert.equal(child.parentId, parent.id);
    });

    it("should get task with progressive context", async () => {
      const result = await executeCode(`
        const milestone = await tasks.create({
          description: "Build API",
          context: "REST API with auth",
          priority: 1
        });
        
        const task = await tasks.create({
          description: "Add login endpoint",
          context: "POST /auth/login",
          parentId: milestone.id,
          priority: 2
        });
        
        const fetched = await tasks.get(task.id);
        return fetched.context;
      `);

      assert.ok(result);
      const context = result as Record<string, string>;
      assert.equal(context.own, "POST /auth/login");
      assert.equal(context.milestone, "REST API with auth");
    });

    it("should complete and reopen task", async () => {
      const result = await executeCode(`
        const task = await tasks.create({
          description: "Completable task"
        });
        
        const completed = await tasks.complete(task.id, "Done!");
        const reopened = await tasks.reopen(completed.id);
        
        return { completed: completed.completed, reopened: reopened.completed };
      `);

      const statuses = result as Record<string, boolean>;
      assert.equal(statuses.completed, true);
      assert.equal(statuses.reopened, false);
    });

    it("should add and remove blockers", async () => {
      const result = await executeCode(`
        const task1 = await tasks.create({ description: "Task 1" });
        const task2 = await tasks.create({ description: "Task 2" });
        
        await tasks.block(task1.id, task2.id);
        const blocked = await tasks.get(task1.id);
        
        await tasks.unblock(task1.id, task2.id);
        const unblocked = await tasks.get(task1.id);
        
        return {
          blockedCount: blocked.blockedBy.length,
          unblockedCount: unblocked.blockedBy.length
        };
      `);

      const counts = result as Record<string, number>;
      assert.equal(counts.blockedCount, 1);
      assert.equal(counts.unblockedCount, 0);
    });

    it("should filter tasks by ready status", async () => {
      const result = await executeCode(`
        // Create blocked task
        const blocker = await tasks.create({ description: "Blocker" });
        const blocked = await tasks.create({
          description: "Blocked",
          blockedBy: [blocker.id]
        });
        
        // Create ready task
        const ready = await tasks.create({ description: "Ready" });
        
        const readyTasks = await tasks.list({ ready: true });
        const blockedTask = readyTasks.find(t => t.id === blocked.id);
        const readyTask = readyTasks.find(t => t.id === ready.id);
        
        return {
          hasBlocked: !!blockedTask,
          hasReady: !!readyTask
        };
      `);

      const flags = result as Record<string, boolean>;
      assert.equal(flags.hasBlocked, false, "Blocked task should not be ready");
      assert.equal(flags.hasReady, true, "Unblocked task should be ready");
    });
  });

  describe("Learnings API", () => {
    it("should add and list learnings", async () => {
      const result = await executeCode(`
        const task = await tasks.create({ description: "Task with learning" });
        
        const learning = await learnings.add(
          task.id,
          "Use TypeScript for type safety"
        );
        
        const list = await learnings.list(task.id);
        
        return { learning, list };
      `);

      assert.ok(result);
      const { learning, list } = result as Record<string, unknown>;
      assert.ok((learning as Record<string, unknown>).id);
      assert.ok(Array.isArray(list));
      assert.equal((list as unknown[]).length, 1);
    });

    it("should delete learning", async () => {
      const result = await executeCode(`
        const task = await tasks.create({ description: "Task" });
        const learning = await learnings.add(task.id, "Test learning");
        
        await learnings.delete(learning.id);
        const list = await learnings.list(task.id);
        
        return list.length;
      `);

      assert.equal(result, 0);
    });

    it("should include learnings in task get", async () => {
      const result = await executeCode(`
        const milestone = await tasks.create({
          description: "Milestone"
        });
        await learnings.add(milestone.id, "Milestone learning");
        
        const task = await tasks.create({
          description: "Task",
          parentId: milestone.id
        });
        
        const fetched = await tasks.get(task.id);
        return fetched.learnings;
      `);

      assert.ok(result);
      const inherited = result as Record<string, unknown[]>;
      assert.ok(inherited.milestone);
      assert.equal(inherited.milestone.length, 1);
    });
  });

  describe("Error Handling", () => {
    it("should handle nonexistent task ID", async () => {
      try {
        await executeCode(`
          return await tasks.get("nonexistent_id");
        `);
        assert.fail("Should have thrown");
      } catch (err) {
        assert.ok(err instanceof Error);
        // CLI will return error for nonexistent ID
      }
    });

    it("should handle cycle detection", async () => {
      try {
        await executeCode(`
          const task1 = await tasks.create({ description: "Task 1" });
          const task2 = await tasks.create({
            description: "Task 2",
            parentId: task1.id
          });
          
          // Try to make task1 a child of task2 (would create cycle)
          await tasks.update(task1.id, { parentId: task2.id });
        `);
        assert.fail("Should have thrown");
      } catch (err) {
        assert.ok(err instanceof Error);
        // CLI should reject the cycle
      }
    });

    it("should handle depth limit", async () => {
      try {
        await executeCode(`
          const task1 = await tasks.create({ description: "L0" });
          const task2 = await tasks.create({ description: "L1", parentId: task1.id });
          const task3 = await tasks.create({ description: "L2", parentId: task2.id });
          
          // Try to create L3 (exceeds max depth of 2)
          await tasks.create({ description: "L3", parentId: task3.id });
        `);
        assert.fail("Should have thrown");
      } catch (err) {
        assert.ok(err instanceof Error);
        // CLI should reject exceeding max depth
      }
    });
  });

  describe("Complex Workflows", () => {
    it("should handle full task lifecycle", async () => {
      const result = await executeCode(`
        // Create milestone
        const milestone = await tasks.create({
          description: "Build feature X",
          context: "New feature for users",
          priority: 1
        });
        
        // Add milestone learning
        await learnings.add(milestone.id, "Follow existing patterns");
        
        // Create subtask
        const task = await tasks.create({
          description: "Implement core logic",
          context: "Handle edge cases",
          parentId: milestone.id,
          priority: 2
        });
        
        // Get task with inherited context
        const fetched = await tasks.get(task.id);
        
        // Start and complete task
        await tasks.start(task.id);
        await tasks.complete(task.id, "Implemented successfully");
        
        // Add learning
        await learnings.add(task.id, "Consider performance", task.id);
        
        // Get final state
        const final = await tasks.get(task.id);
        
        return {
          hasContext: !!final.context.milestone,
          hasLearnings: final.learnings.milestone.length > 0,
          isCompleted: final.completed
        };
      `);

      assert.ok(result);
      const workflow = result as Record<string, boolean | number>;
      assert.equal(workflow.hasContext, true);
      assert.equal(workflow.hasLearnings, true);
      assert.equal(workflow.isCompleted, true);
    });
  });
});
