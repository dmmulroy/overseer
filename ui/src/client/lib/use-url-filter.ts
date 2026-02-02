import { useCallback, useSyncExternalStore } from "react";
import { isTaskId, type TaskId } from "../../types.js";

/** Custom event for internal URL changes (distinct from browser navigation) */
const URL_CHANGE_EVENT = "os:urlchange";

/**
 * Parse milestone ID from URL search params.
 * Returns null if param missing or invalid.
 */
function getMilestoneFromUrl(): TaskId | null {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("milestone");
  if (value === null) return null;
  return isTaskId(value) ? value : null;
}

/**
 * Subscribe to URL changes from both browser navigation and internal updates.
 * - popstate: real back/forward navigation
 * - os:urlchange: internal replaceState calls
 */
function subscribeToUrlChanges(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  window.addEventListener(URL_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(URL_CHANGE_EVENT, callback);
  };
}

/**
 * Hook for URL-based milestone filter state.
 *
 * - Reads from ?milestone= URL param
 * - Updates URL via replaceState (no history entry)
 * - Syncs with browser back/forward via popstate
 * - Returns null for missing or invalid values
 *
 * @returns [filterMilestoneId, setFilterMilestoneId] tuple
 */
export function useMilestoneFilter(): [
  TaskId | null,
  (id: TaskId | null) => void,
] {
  const filterMilestoneId = useSyncExternalStore(
    subscribeToUrlChanges,
    getMilestoneFromUrl,
    () => null // SSR fallback
  );

  const setFilterMilestoneId = useCallback((id: TaskId | null) => {
    const url = new URL(window.location.href);
    if (id === null) {
      url.searchParams.delete("milestone");
    } else {
      url.searchParams.set("milestone", id);
    }
    // Preserve existing history.state to avoid clobbering other state
    window.history.replaceState(window.history.state, "", url.toString());
    // Dispatch custom event (not popstate) to trigger re-read
    window.dispatchEvent(new Event(URL_CHANGE_EVENT));
  }, []);

  return [filterMilestoneId, setFilterMilestoneId];
}
