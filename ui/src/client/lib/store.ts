/**
 * Zustand UI store for multi-view layout state.
 *
 * Manages ephemeral UI coordination:
 * - View mode (graph/kanban/list)
 * - Task selection and focus (keyboard nav)
 * - Detail panel visibility and height
 *
 * Server state (tasks/learnings) stays in TanStack Query.
 */

import { create } from "zustand";
import type { TaskId } from "../../types.js";

export type ViewMode = "graph" | "kanban" | "list";

/** localStorage key for panel height persistence */
const PANEL_HEIGHT_KEY = "ui.layout.v1.detailPanelHeight";

/** Default panel height in pixels */
const DEFAULT_PANEL_HEIGHT = 320;

/** Minimum panel height in pixels */
export const PANEL_HEIGHT_MIN = 120;

/** Maximum panel height as viewport fraction (converted to px on load) */
export const PANEL_HEIGHT_MAX_VH = 0.6;

/**
 * Clamp panel height to valid range (120px min, 60vh max).
 * Exported for use in drag handlers that need immediate clamping.
 */
export function clampPanelHeight(height: number): number {
  const maxPx = Math.floor(window.innerHeight * PANEL_HEIGHT_MAX_VH);
  return Math.max(PANEL_HEIGHT_MIN, Math.min(height, maxPx));
}

/**
 * Load and validate persisted panel height.
 * Returns clamped value or default on error/invalid.
 */
function loadPanelHeight(): number {
  try {
    const stored = localStorage.getItem(PANEL_HEIGHT_KEY);
    if (stored === null) return DEFAULT_PANEL_HEIGHT;

    const value = Number.parseInt(stored, 10);
    if (Number.isNaN(value)) return DEFAULT_PANEL_HEIGHT;

    // Clamp to valid range (min 120px, max 60vh)
    return clampPanelHeight(value);
  } catch {
    // Private browsing or storage disabled
    return DEFAULT_PANEL_HEIGHT;
  }
}

/**
 * Persist panel height to localStorage.
 * Silently ignores errors (private browsing).
 */
function savePanelHeight(height: number): void {
  try {
    localStorage.setItem(PANEL_HEIGHT_KEY, String(height));
  } catch {
    // Ignore - private browsing or quota exceeded
  }
}

interface UIState {
  /** Active view (graph default) */
  viewMode: ViewMode;
  /** Selected task for detail panel */
  selectedTaskId: TaskId | null;
  /** Focused task for keyboard navigation (separate from selection) */
  focusedTaskId: TaskId | null;
  /** Detail panel visibility */
  detailPanelOpen: boolean;
  /** Detail panel height in pixels (persisted) */
  panelHeight: number;
}

interface UIActions {
  setViewMode: (mode: ViewMode) => void;
  setSelectedTaskId: (id: TaskId | null) => void;
  setFocusedTaskId: (id: TaskId | null) => void;
  toggleDetailPanel: () => void;
  setDetailPanelOpen: (open: boolean) => void;
  /** Set panel height and persist to localStorage */
  setPanelHeight: (height: number) => void;
  /** Clear selection/focus if task no longer exists */
  clearIfMissing: (existingIds: Set<TaskId>) => void;
}

export type UIStore = UIState & UIActions;

export const useUIStore = create<UIStore>((set) => ({
  // Initial state
  viewMode: "graph",
  selectedTaskId: null,
  focusedTaskId: null,
  detailPanelOpen: false,
  panelHeight: loadPanelHeight(),

  // Actions
  setViewMode: (mode) => set({ viewMode: mode }),

  setSelectedTaskId: (id) =>
    set((state) => ({
      selectedTaskId: id,
      // Auto-open detail panel when selecting; preserve state when clearing
      detailPanelOpen: id !== null ? true : state.detailPanelOpen,
    })),

  setFocusedTaskId: (id) => set({ focusedTaskId: id }),

  toggleDetailPanel: () =>
    set((state) => ({ detailPanelOpen: !state.detailPanelOpen })),

  setDetailPanelOpen: (open) => set({ detailPanelOpen: open }),

  setPanelHeight: (height) => {
    const clamped = clampPanelHeight(height);
    savePanelHeight(clamped);
    set({ panelHeight: clamped });
  },

  clearIfMissing: (existingIds) =>
    set((state) => ({
      selectedTaskId:
        state.selectedTaskId && existingIds.has(state.selectedTaskId)
          ? state.selectedTaskId
          : null,
      focusedTaskId:
        state.focusedTaskId && existingIds.has(state.focusedTaskId)
          ? state.focusedTaskId
          : null,
    })),
}));

/**
 * Selector hooks for specific slices (prevents unnecessary re-renders)
 */
export const useViewMode = () => useUIStore((s) => s.viewMode);
export const useSelectedTaskId = () => useUIStore((s) => s.selectedTaskId);
export const useFocusedTaskId = () => useUIStore((s) => s.focusedTaskId);
export const useDetailPanelOpen = () => useUIStore((s) => s.detailPanelOpen);
export const usePanelHeight = () => useUIStore((s) => s.panelHeight);
