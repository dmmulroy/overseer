import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Task,
  TaskWithContext,
  UpdateTaskRequest,
  CompleteTaskRequest,
  CreateTaskRequest,
  Learning,
  TaskFilter,
  ApiError,
} from "../../types.js";

/** Default refetch interval (5 seconds) */
const REFETCH_INTERVAL = 5000;

/** Base URL for API calls */
const API_BASE = "";

/** Type guard for API error responses */
function isApiError(err: unknown): err is ApiError {
  return (
    err !== null &&
    typeof err === "object" &&
    "error" in err &&
    typeof (err as Record<string, unknown>)["error"] === "string"
  );
}

/** Extract error message from response or unknown error */
function getErrorMessage(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.error;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

/** Query keys for cache management */
export const queryKeys = {
  tasks: {
    all: ["tasks"] as const,
    list: (filter?: TaskFilter) => ["tasks", "list", filter] as const,
    detail: (id: string) => ["tasks", "detail", id] as const,
    nextReady: (milestoneId?: string) => ["tasks", "next-ready", milestoneId] as const,
  },
  learnings: {
    byTask: (taskId: string) => ["learnings", taskId] as const,
  },
} as const;

/**
 * Fetch all tasks with optional filters
 */
export function useTasks(filter?: TaskFilter) {
  return useQuery({
    queryKey: queryKeys.tasks.list(filter),
    queryFn: async (): Promise<Task[]> => {
      const params = new URLSearchParams();
      if (filter?.parentId) params.set("parentId", filter.parentId);
      if (filter?.ready !== undefined) params.set("ready", String(filter.ready));
      if (filter?.completed !== undefined) params.set("completed", String(filter.completed));

      const url = `${API_BASE}/api/tasks${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to fetch tasks"));
      }

      return res.json() as Promise<Task[]>;
    },
    refetchInterval: REFETCH_INTERVAL,
  });
}

/**
 * Fetch single task with full context
 */
export function useTask(id: string | null) {
  return useQuery({
    queryKey: queryKeys.tasks.detail(id ?? ""),
    queryFn: async (): Promise<TaskWithContext | null> => {
      if (!id) return null;

      const res = await fetch(`${API_BASE}/api/tasks/${id}`);

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to fetch task"));
      }

      return res.json() as Promise<TaskWithContext>;
    },
    enabled: !!id,
    refetchInterval: REFETCH_INTERVAL,
  });
}

/**
 * Fetch next ready task
 */
export function useNextReadyTask(milestoneId?: string) {
  return useQuery({
    queryKey: queryKeys.tasks.nextReady(milestoneId),
    queryFn: async (): Promise<TaskWithContext | null> => {
      const params = milestoneId ? `?milestoneId=${milestoneId}` : "";
      const res = await fetch(`${API_BASE}/api/tasks/next-ready${params}`);

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to fetch next ready task"));
      }

      return res.json() as Promise<TaskWithContext | null>;
    },
    refetchInterval: REFETCH_INTERVAL,
  });
}

/**
 * Update task mutation
 */
export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTaskRequest }): Promise<Task> => {
      const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to update task"));
      }

      return res.json() as Promise<Task>;
    },
    onSuccess: (_data: Task, { id }: { id: string; data: UpdateTaskRequest }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) });
    },
  });
}

/**
 * Complete task mutation
 */
export function useCompleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data?: CompleteTaskRequest }): Promise<Task> => {
      const res = await fetch(`${API_BASE}/api/tasks/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data ?? {}),
      });

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to complete task"));
      }

      return res.json() as Promise<Task>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

/**
 * Reopen task mutation
 */
export function useReopenTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<Task> => {
      const res = await fetch(`${API_BASE}/api/tasks/${id}/reopen`, {
        method: "POST",
      });

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to reopen task"));
      }

      return res.json() as Promise<Task>;
    },
    onSuccess: (_data: Task, id: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) });
    },
  });
}

/**
 * Delete task mutation
 */
export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<{ deleted: boolean }> => {
      const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to delete task"));
      }

      return res.json() as Promise<{ deleted: boolean }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

/**
 * Create task mutation
 */
export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTaskRequest): Promise<Task> => {
      const res = await fetch(`${API_BASE}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to create task"));
      }

      return res.json() as Promise<Task>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

/**
 * Fetch learnings for a task
 */
export function useLearnings(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.learnings.byTask(taskId ?? ""),
    queryFn: async (): Promise<Learning[]> => {
      if (!taskId) return [];

      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/learnings`);

      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        throw new Error(getErrorMessage(err, "Failed to fetch learnings"));
      }

      return res.json() as Promise<Learning[]>;
    },
    enabled: !!taskId,
    refetchInterval: REFETCH_INTERVAL,
  });
}
