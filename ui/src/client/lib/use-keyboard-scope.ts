import { useId, useLayoutEffect, useRef } from "react";
import { useKeyboardContext, type ShortcutScope } from "./keyboard";

export interface UseKeyboardScopeOptions {
  /**
   * Whether the scope claim is enabled. When false, no claim is made.
   * @default true
   */
  enabled?: boolean;
  /**
   * Whether to activate the scope on mount.
   * @default true
   */
  activateOnMount?: boolean;
}

export interface ScopeEventHandlers {
  /** Spread onto container element to activate scope on pointer down */
  onPointerDownCapture: () => void;
  /** Spread onto container element to activate scope on focus */
  onFocusCapture: () => void;
}

/**
 * Hook for components to claim and manage keyboard scope ownership.
 *
 * Handles claim lifecycle automatically:
 * - On mount: claims scope, optionally activates
 * - On unmount: releases scope
 * - Returns event handlers that activate scope on pointer/focus
 *
 * @example
 * ```tsx
 * function TaskGraph() {
 *   const scopeProps = useKeyboardScope("graph", { activateOnMount: true });
 *   return <div {...scopeProps}>...</div>;
 * }
 * ```
 */
export function useKeyboardScope(
  scope: ShortcutScope,
  options: UseKeyboardScopeOptions = {}
): ScopeEventHandlers {
  const { enabled = true, activateOnMount = true } = options;
  const { claimScope } = useKeyboardContext();

  // Generate stable ID for this component instance
  const id = useId();
  const claimId = `scope-${scope}-${id}`;

  // Store token ref to call activate() in event handlers
  const tokenRef = useRef<ReturnType<typeof claimScope> | null>(null);

  // useLayoutEffect ensures token is set before browser delivers pointer/focus events
  useLayoutEffect(() => {
    if (!enabled) return;

    const token = claimScope(claimId, scope);
    tokenRef.current = token;

    if (activateOnMount) {
      token.activate();
    }

    return () => {
      token.release();
      tokenRef.current = null;
    };
  }, [claimScope, claimId, scope, enabled, activateOnMount]);

  // Event handlers call activate() on interaction
  const onPointerDownCapture = (): void => {
    tokenRef.current?.activate();
  };

  const onFocusCapture = (): void => {
    tokenRef.current?.activate();
  };

  return { onPointerDownCapture, onFocusCapture };
}
