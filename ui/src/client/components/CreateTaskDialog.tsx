import { useState, useCallback, useEffect } from "react";
import { tv } from "tailwind-variants";
import { useCreateTask } from "../lib/queries.js";
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
import type { Priority } from "../../types.js";

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const inputField = tv({
  base: [
    "w-full font-mono text-sm",
    "bg-surface-primary text-text-primary placeholder:text-text-dim",
    "border border-border rounded",
    "px-3 py-2",
    "focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus",
    "transition-colors duration-150 motion-reduce:transition-none",
  ],
});

const label = tv({
  base: "font-mono text-xs font-medium uppercase tracking-wider text-text-muted",
});

const priorityButton = tv({
  base: [
    "flex-1 h-9 font-mono text-sm font-medium",
    "border rounded transition-colors duration-150 motion-reduce:transition-none",
    "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-bg-primary focus:ring-border-focus",
  ],
  variants: {
    selected: {
      true: "bg-accent text-bg-primary border-accent",
      false: "bg-surface-primary text-text-muted border-border hover:text-text-primary hover:border-border-hover",
    },
  },
});

/**
 * Dialog for creating a new task (milestone).
 * 
 * Fields:
 * - Description (required)
 * - Context (optional)
 * - Priority (default: 1 - Medium)
 * 
 * Note: Parent selection will be added in a future PR.
 */
export function CreateTaskDialog({
  open,
  onOpenChange,
}: CreateTaskDialogProps) {
  const [description, setDescription] = useState("");
  const [context, setContext] = useState("");
  const [priority, setPriority] = useState<Priority>(1);

  const createTask = useCreateTask();

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setDescription("");
      setContext("");
      setPriority(1);
      createTask.reset();
    }
  }, [open]);

  const handleSubmit = useCallback(() => {
    if (!description.trim()) return;

    createTask.mutate(
      {
        description: description.trim(),
        context: context.trim() || undefined,
        priority,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  }, [description, context, priority, createTask, onOpenChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isValid = description.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Create Task</DialogTitle>
        <DialogDescription>
          Add a new milestone to your project.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        {/* Description */}
        <div className="space-y-1.5">
          <label htmlFor="task-description" className={label()}>
            Description <span className="text-status-blocked">*</span>
          </label>
          <Textarea
            id="task-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What needs to be done?"
            rows={2}
            autoFocus
          />
        </div>

        {/* Context */}
        <div className="space-y-1.5">
          <label htmlFor="task-context" className={label()}>
            Context <span className="text-text-dim">(optional)</span>
          </label>
          <Textarea
            id="task-context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Additional context, requirements, or notes..."
            rows={3}
          />
        </div>

        {/* Priority */}
        <div className="space-y-1.5">
          <label className={label()}>Priority</label>
          <div className="flex gap-2">
            <button
              type="button"
              className={priorityButton({ selected: priority === 0 })}
              onClick={() => setPriority(0)}
            >
              p0 High
            </button>
            <button
              type="button"
              className={priorityButton({ selected: priority === 1 })}
              onClick={() => setPriority(1)}
            >
              p1 Medium
            </button>
            <button
              type="button"
              className={priorityButton({ selected: priority === 2 })}
              onClick={() => setPriority(2)}
            >
              p2 Low
            </button>
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button
          variant="secondary"
          onClick={() => onOpenChange(false)}
          disabled={createTask.isPending}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!isValid || createTask.isPending}
        >
          {createTask.isPending ? "Creating..." : "Create Task"}
        </Button>
      </DialogFooter>

      {createTask.isError && (
        <div className="px-6 pb-4">
          <p className="font-mono text-sm text-status-blocked">
            {createTask.error.message}
          </p>
        </div>
      )}
    </Dialog>
  );
}
