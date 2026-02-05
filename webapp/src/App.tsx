import { WorkerPoolContextProvider, FileDiff, Virtualizer } from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import { useMemo } from "react";

const DIFF_OPTIONS = {
  theme: { dark: "pierre-dark", light: "pierre-light" },
  themeType: "dark" as const,
  diffStyle: "split" as const,
  diffIndicators: "bars" as const,
  lineDiffType: "word-alt" as const,
  overflow: "scroll" as const,
  hunkSeparators: "line-info" as const,
  enableLineSelection: true,
  lineHoverHighlight: "both" as const,
  tokenizeMaxLineLength: 1000,
  maxLineDiffLength: 1000,
};

const WORKER_OPTIONS = {
  poolSize: Math.min(Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1), 3),
  workerFactory() {
    return new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url));
  },
};

const HIGHLIGHTER_OPTIONS = {
  theme: { dark: "pierre-dark", light: "pierre-light" },
  langs: ["rust", "toml", "tsx", "typescript", "json"],
};

export function App() {
  const diff = useMemo(() => {
    const oldFile = {
      name: "tasks.rs",
      contents: "pub fn start(task_id: TaskId) -> Result<Task, TaskError> {\n    todo!()\n}\n",
      cacheKey: "old-task",
    };
    const newFile = {
      name: "tasks.rs",
      contents:
        "pub fn start(task_id: TaskId) -> Result<Task, TaskError> {\n    validate_repo_clean()?;\n    task_repo.start(task_id)\n}\n",
      cacheKey: "new-task",
    };
    return parseDiffFromFile(oldFile, newFile);
  }, []);

  return (
    <WorkerPoolContextProvider poolOptions={WORKER_OPTIONS} highlighterOptions={HIGHLIGHTER_OPTIONS}>
      <div className="app-shell">
        <header className="app-header">
          <div className="app-title">
            <span className="app-title__mark">os</span>
            <div>
              <div className="app-title__name">Overseer v2</div>
              <div className="app-title__sub">Local-first review console</div>
            </div>
          </div>
          <div className="app-status">
            <div className="status-dot" />
            <span>relay connected</span>
          </div>
        </header>

        <main className="app-main">
          <section className="panel panel--left">
            <div className="panel-title">Tasks</div>
            <div className="panel-body">
              <div className="task-item">
                <div>
                  <div className="task-title">Wire VCS submit workflow</div>
                  <div className="task-meta">task_01HX… · InReview</div>
                </div>
                <div className="pill">Active</div>
              </div>
              <div className="task-item">
                <div>
                  <div className="task-title">Gate polling scheduler</div>
                  <div className="task-meta">task_01HX… · InProgress</div>
                </div>
                <div className="pill pill--muted">Blocked</div>
              </div>
            </div>
          </section>

          <section className="panel panel--center">
            <div className="panel-title">Review Diff</div>
            <div className="panel-body panel-body--diff">
              <Virtualizer
                className="diff-viewport"
                contentClassName="diff-viewport__content"
              >
                <FileDiff fileDiff={diff} options={DIFF_OPTIONS} />
              </Virtualizer>
            </div>
          </section>

          <section className="panel panel--right">
            <div className="panel-title">Review Notes</div>
            <div className="panel-body">
              <div className="note">Gate: lint failed on src/tasks.rs:42</div>
              <div className="note">Requested: re-run after fix</div>
              <div className="note">Next: agent approval</div>
            </div>
          </section>
        </main>
      </div>
    </WorkerPoolContextProvider>
  );
}
