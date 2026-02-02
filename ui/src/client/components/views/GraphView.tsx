/**
 * Graph view - wraps existing TaskGraph component.
 */

import type { Task, TaskId } from "../../../types.js";
import { TaskGraph } from "../TaskGraph.js";

interface GraphViewProps {
  tasks: Task[];
  externalBlockers: Map<TaskId, Task>;
  selectedId: TaskId | null;
  onSelect: (id: TaskId) => void;
}

export function GraphView({
  tasks,
  externalBlockers,
  selectedId,
  onSelect,
}: GraphViewProps) {
  return (
    <div className="flex-1 flex bg-bg-primary min-h-0">
      <TaskGraph
        tasks={tasks}
        externalBlockers={externalBlockers}
        selectedId={selectedId}
        onSelect={onSelect}
        showBlockers={externalBlockers.size > 0}
      />
    </div>
  );
}
