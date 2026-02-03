import { useState, useCallback, useEffect } from "react";
import { tv } from "tailwind-variants";
import {
  useUpdateTask,
  useCompleteTask,
  useDeleteTask,
  useLearnings,
} from "../lib/queries.js";
import { useKeyboardShortcuts } from "../lib/keyboard.js";
import { useKeyboardScope } from "../lib/use-keyboard-scope.js";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "./ui/Dialog.js";
import { Button } from "./ui/Button.js";
import { Textarea } from "./ui/Textarea.js";
import { Kbd } from "./ui/Kbd.js";
import type { TaskWithContext, TaskId, Learning } from "../../types.js";

interface TaskDetailProps {
  task: TaskWithContext;
  onDeleted?: () => void;
}

type EditMode = "none" | "description" | "context" | "priority";

// Field styling variants
const field = tv({
  slots: {
    container: "space-y-1",
    label: "font-mono text-xs font-medium uppercase tracking-wider text-text-muted",
    value: "font-mono text-sm text-text-primary",
  },
});

const { container, label, value } = field();

// Status badge variant - intentionally differs from Badge component:
// no border, no uppercase, simpler styling for inline detail display
const statusBadge = tv({
  base: "font-mono text-xs px-2 py-0.5 rounded",
  variants: {
    status: {
      pending: "bg-status-pending/20 text-status-pending",
      active: "bg-status-active/20 text-status-active",
      blocked: "bg-status-blocked/20 text-status-blocked",
      done: "bg-status-done/20 text-status-done",
    },
  },
});

// Edit field styling
const editField = tv({
  base: [
    "w-full font-mono text-sm",
    "bg-surface-primary border border-accent rounded",
    "px-2 py-1.5",
    "focus:outline-none focus:ring-1 focus:ring-accent",
  ],
});

/**
 * Task detail panel with industrial styling and keyboard shortcuts.
 * 
 * Keyboard: e=edit, c=complete (if unblocked), Backspace=delete (with confirm)
 */
export function TaskDetail({ task, onDeleted }: TaskDetailProps) {
  const [editMode, setEditMode] = useState<EditMode>("none");
  const [editValue, setEditValue] = useState("");
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [completeResult, setCompleteResult] = useState("");
  const [copied, setCopied] = useState(false);

  const scopeProps = useKeyboardScope("detail");
  const { data: learnings } = useLearnings(task.id);
  const updateTask = useUpdateTask();
  const completeTask = useCompleteTask();
  const deleteTask = useDeleteTask();

  const depthLabel =
    task.depth === 0 ? "Milestone" : task.depth === 1 ? "Task" : "Subtask";

  const isBlocked = task.effectivelyBlocked && !task.completed;

  const startEdit = useCallback((mode: EditMode, val: string) => {
    setEditMode(mode);
    setEditValue(val);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditMode("none");
    setEditValue("");
  }, []);

  const saveEdit = useCallback(() => {
    if (editMode === "none") return;

    const data: Record<string, unknown> = {};
    if (editMode === "description") {
      data.description = editValue;
    } else if (editMode === "context") {
      data.context = editValue;
    } else if (editMode === "priority") {
      const priority = parseInt(editValue, 10);
      if (priority >= 1 && priority <= 5) {
        data.priority = priority;
      }
    }

    updateTask.mutate(
      { id: task.id, data },
      {
        onSuccess: () => cancelEdit(),
      },
    );
  }, [editMode, editValue, task.id, updateTask, cancelEdit]);

  const handleComplete = useCallback(() => {
    completeTask.mutate(
      {
        id: task.id,
        data: completeResult ? { result: completeResult } : undefined,
      },
      {
        onSuccess: () => {
          setShowCompleteDialog(false);
          setCompleteResult("");
        },
      },
    );
  }, [task.id, completeResult, completeTask]);

  const handleDelete = useCallback(() => {
    deleteTask.mutate(task.id, {
      onSuccess: () => {
        setShowDeleteDialog(false);
        onDeleted?.();
      },
    });
  }, [task.id, deleteTask, onDeleted]);

  const copyTaskId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(task.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy task ID:", err);
    }
  }, [task.id]);

  // Reset edit mode when task changes
  useEffect(() => {
    cancelEdit();
  }, [task.id, cancelEdit]);

  // Keyboard shortcuts for detail scope
  useKeyboardShortcuts(
    () => [
      {
        key: "e",
        description: "Edit task description",
        scope: "detail",
        handler: () => {
          if (editMode === "none" && !task.completed) {
            startEdit("description", task.description);
          }
        },
      },
      {
        key: "c",
        description: "Complete task",
        scope: "detail",
        handler: () => {
          if (!task.completed && !isBlocked && !showCompleteDialog && !showDeleteDialog) {
            setShowCompleteDialog(true);
          }
        },
      },
      {
        key: "Backspace",
        description: "Delete task",
        scope: "detail",
        handler: () => {
          if (!task.completed && !showCompleteDialog && !showDeleteDialog) {
            setShowDeleteDialog(true);
          }
        },
      },
      {
        key: "Escape",
        description: "Cancel edit",
        scope: "detail",
        handler: () => {
          if (editMode !== "none") {
            cancelEdit();
          }
        },
      },
    ],
    [task.id, task.completed, task.description, isBlocked, editMode, startEdit, cancelEdit, showCompleteDialog, showDeleteDialog]
  );

  // Derive status
  const status = task.completed
    ? "done"
    : isBlocked
      ? "blocked"
      : task.startedAt
        ? "active"
        : "pending";

  const statusLabel = task.completed
    ? "Completed"
    : isBlocked
      ? "Blocked"
      : task.startedAt
        ? "In Progress"
        : "Pending";

  return (
    <div className="flex flex-col h-full" {...scopeProps}>
      {/* Content - scrollable area with fields */}
      <dl className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-x-6 gap-y-4">
        {/* ID */}
        <div className={container()}>
          <dt className={label()}>ID</dt>
          <dd className="flex items-start gap-2">
            <code className="font-mono text-xs text-text-muted break-all select-all flex-1">
              {task.id}
            </code>
            <button
              onClick={copyTaskId}
              className="inline-flex items-center justify-center p-1 text-text-muted hover:text-accent transition-colors duration-150 motion-reduce:transition-none rounded hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus shrink-0"
              title={copied ? "Copied!" : "Copy task ID"}
              aria-label={copied ? "Copied!" : "Copy task ID"}
            >
              {copied ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="w-4 h-4 text-accent"
                  aria-hidden="true"
                >
                  <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h2.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 1 .439 1.061V9.5A1.5 1.5 0 0 1 12 11V8.621a3 3 0 0 0-.879-2.121L9 4.379A3 3 0 0 0 6.879 3.5H5.5Z" />
                  <path d="M4 5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 14h5a1.5 1.5 0 0 0 1.5-1.5V8.621a1.5 1.5 0 0 0-.44-1.06L7.94 5.439A1.5 1.5 0 0 0 6.878 5H4Z" />
                </svg>
              )}
            </button>
          </dd>
        </div>

        {/* Status */}
        <div className={container()}>
          <dt className={label()}>Status</dt>
          <dd>
            <span className={statusBadge({ status })}>{statusLabel}</span>
          </dd>
        </div>

        {/* Description */}
        <div className={`${container()} col-span-2`}>
          <dt className={label()}>
            Description
            {!task.completed && editMode === "none" && (
              <span className="ml-2 text-text-dim">[<Kbd size="sm">e</Kbd> to edit]</span>
            )}
          </dt>
          <dd>
            {editMode === "description" ? (
              <EditField
                value={editValue}
                onChange={setEditValue}
                onSave={saveEdit}
                onCancel={cancelEdit}
                multiline
                saving={updateTask.isPending}
              />
            ) : (
              <button
                type="button"
                disabled={task.completed}
                onClick={() => startEdit("description", task.description)}
                className={`${value()} text-left p-0 border-0 bg-transparent cursor-pointer hover:text-accent transition-colors motion-reduce:transition-none disabled:cursor-default disabled:hover:text-text-primary`}
                title={task.completed ? undefined : "Click to edit"}
              >
                {task.description}
              </button>
            )}
          </dd>
        </div>

        {/* Type/Depth */}
        <div className={container()}>
          <dt className={label()}>Type</dt>
          <dd className={value()}>{depthLabel}</dd>
        </div>

        {/* Priority */}
        <div className={container()}>
          <dt className={label()}>Priority</dt>
          <dd>
            {editMode === "priority" ? (
              <EditField
                value={editValue}
                onChange={setEditValue}
                onSave={saveEdit}
                onCancel={cancelEdit}
                type="number"
                min={1}
                max={5}
                saving={updateTask.isPending}
              />
            ) : (
              <button
                type="button"
                disabled={task.completed}
                onClick={() => startEdit("priority", String(task.priority))}
                className={`${value()} text-left p-0 border-0 bg-transparent cursor-pointer hover:text-accent transition-colors motion-reduce:transition-none disabled:cursor-default disabled:hover:text-text-primary`}
                title={task.completed ? undefined : "Click to edit (1-5)"}
              >
                P{task.priority}
              </button>
            )}
          </dd>
        </div>

        {/* Context */}
        <div className={`${container()} col-span-2`}>
          <dt className={label()}>Context</dt>
          <dd>
            {editMode === "context" ? (
              <EditField
                value={editValue}
                onChange={setEditValue}
                onSave={saveEdit}
                onCancel={cancelEdit}
                multiline
                saving={updateTask.isPending}
              />
            ) : (
              <button
                type="button"
                disabled={task.completed}
                onClick={() => startEdit("context", task.context.own)}
                className="w-full text-left p-0 border-0 bg-transparent cursor-pointer disabled:cursor-default"
                title={task.completed ? undefined : "Click to edit"}
              >
                <pre
                  className={`${value()} whitespace-pre-wrap bg-surface-primary p-2 rounded text-text-muted hover:border-accent border border-transparent transition-colors motion-reduce:transition-none`}
                >
                  {task.context.own || "(empty)"}
                </pre>
              </button>
            )}
          </dd>
        </div>

        {/* Result (read-only, only shown when completed) */}
        {task.result && (
          <div className={`${container()} col-span-2`}>
            <dt className={label()}>Result</dt>
            <dd>
              <pre className={`${value()} whitespace-pre-wrap bg-surface-primary p-2 rounded`}>
                {task.result}
              </pre>
            </dd>
          </div>
        )}

        {/* Blockers */}
        {task.blockedBy && task.blockedBy.length > 0 && (
          <div className={`${container()} col-span-2`}>
            <dt className={label()}>Blocked By</dt>
            <dd>
              <ul className="space-y-1">
                {task.blockedBy.map((blockerId: TaskId) => (
                  <li key={blockerId} className="font-mono text-xs text-status-blocked">
                    {blockerId}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}

        {/* Blocks */}
        {task.blocks && task.blocks.length > 0 && (
          <div className={`${container()} col-span-2`}>
            <dt className={label()}>Blocks</dt>
            <dd>
              <ul className="space-y-1">
                {task.blocks.map((blockedId: TaskId) => (
                  <li key={blockedId} className="font-mono text-xs text-text-muted">
                    {blockedId}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}

        {/* Learnings */}
        {learnings && learnings.length > 0 && (
          <div className={`${container()} col-span-2`}>
            <dt className={label()}>Learnings ({learnings.length})</dt>
            <dd>
              <ul className="space-y-2">
                {learnings.map((learning: Learning) => (
                  <li
                    key={learning.id}
                    className="font-mono text-xs p-2 bg-surface-primary rounded border-l-2 border-accent"
                  >
                    {learning.content}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}

        {/* Timestamps row */}
        <div className={container()}>
          <dt className={label()}>Created</dt>
          <dd>
            <time className="font-mono text-xs text-text-muted">
              {new Date(task.createdAt).toLocaleString()}
            </time>
          </dd>
        </div>

        {task.startedAt && (
          <div className={container()}>
            <dt className={label()}>Started</dt>
            <dd>
              <time className="font-mono text-xs text-text-muted">
                {new Date(task.startedAt).toLocaleString()}
              </time>
            </dd>
          </div>
        )}

        {task.completedAt && (
          <div className={container()}>
            <dt className={label()}>Completed</dt>
            <dd>
              <time className="font-mono text-xs text-text-muted">
                {new Date(task.completedAt).toLocaleString()}
              </time>
            </dd>
          </div>
        )}

        {task.commitSha && (
          <div className={container()}>
            <dt className={label()}>Commit</dt>
            <dd>
              <code className="font-mono text-xs text-text-muted">{task.commitSha}</code>
            </dd>
          </div>
        )}
      </dl>

      {/* Action buttons footer */}
      {!task.completed && (
        <footer className="p-4 border-t border-border flex gap-2">
          <Button
            variant={isBlocked ? "secondary" : "primary"}
            onClick={() => setShowCompleteDialog(true)}
            disabled={isBlocked}
            className="flex-1"
            title={isBlocked ? "Complete blockers first" : "Complete this task"}
          >
            {isBlocked ? "Blocked" : "Complete"}
            {!isBlocked && <Kbd size="sm" className="ml-1">c</Kbd>}
          </Button>
          <Button
            variant="danger"
            onClick={() => setShowDeleteDialog(true)}
            title="Delete this task"
          >
            Delete
            <Kbd size="sm" className="ml-1">⌫</Kbd>
          </Button>
        </footer>
      )}

      {/* Complete Dialog */}
      <Dialog
        open={showCompleteDialog}
        onOpenChange={setShowCompleteDialog}
      >
        <DialogHeader>
          <DialogTitle>Complete Task</DialogTitle>
          <DialogDescription>
            Add an optional result summary for this task.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Textarea
            value={completeResult}
            onChange={(e) => setCompleteResult(e.target.value)}
            placeholder="What was accomplished? (optional)"
            rows={4}
          />
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setShowCompleteDialog(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleComplete}
            disabled={completeTask.isPending}
          >
            {completeTask.isPending ? "Completing..." : "Complete"}
          </Button>
        </DialogFooter>
        {completeTask.isError && (
          <div className="px-6 pb-4">
            <p className="text-sm text-status-blocked">
              {completeTask.error.message}
            </p>
          </div>
        )}
      </Dialog>

      {/* Delete Dialog */}
      <Dialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
      >
        <DialogHeader>
          <DialogTitle>Delete Task</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this task? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => setShowDeleteDialog(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            disabled={deleteTask.isPending}
          >
            {deleteTask.isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
        {deleteTask.isError && (
          <div className="px-6 pb-4">
            <p className="text-sm text-status-blocked">
              {deleteTask.error.message}
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

interface EditFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  multiline?: boolean;
  type?: string;
  min?: number;
  max?: number;
  saving?: boolean;
}

function EditField({
  value,
  onChange,
  onSave,
  onCancel,
  multiline,
  type = "text",
  min,
  max,
  saving,
}: EditFieldProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation(); // Prevent keyboard framework from handling
      onCancel();
    } else if (e.key === "Enter" && !multiline) {
      onSave();
    } else if (e.key === "Enter" && e.metaKey) {
      onSave();
    }
  };

  return (
    <div className="space-y-2">
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={4}
          className={editField()}
          autoFocus
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          min={min}
          max={max}
          className={editField()}
          autoFocus
        />
      )}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
