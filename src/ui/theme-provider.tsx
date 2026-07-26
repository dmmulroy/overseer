import * as Result from "effect/Result";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

/** Theme preference selected by the human. */
export type ThemePreference = "light" | "dark" | "system";

type ThemeStorageStatus = "available" | "invalid" | "unavailable";

type ThemeContextValue = {
  readonly preference: ThemePreference;
  readonly setPreference: (preference: ThemePreference) => void;
  readonly storageStatus: ThemeStorageStatus;
};

type StoredThemePreference = {
  readonly preference: ThemePreference;
  readonly storageStatus: ThemeStorageStatus;
};

const storageKey = "overseer-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredThemePreference(): StoredThemePreference {
  const stored = Result.try(() => localStorage.getItem(storageKey));
  if (Result.isFailure(stored)) {
    return { preference: "system", storageStatus: "unavailable" };
  }
  if (
    stored.success === "light" ||
    stored.success === "dark" ||
    stored.success === "system" ||
    stored.success === null
  ) {
    return {
      preference: stored.success ?? "system",
      storageStatus: "available",
    };
  }
  return { preference: "system", storageStatus: "invalid" };
}

function applyTheme(preference: ThemePreference): void {
  const resolved =
    preference === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

/** Own theme persistence and live operating-system preference changes. */
export function ThemeProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [storedPreference] = useState(readStoredThemePreference);
  const [preference, setPreferenceState] = useState<ThemePreference>(storedPreference.preference);
  const [storageStatus, setStorageStatus] = useState<ThemeStorageStatus>(
    storedPreference.storageStatus,
  );
  const setPreference = useCallback((next: ThemePreference) => {
    const persisted = Result.try(() => localStorage.setItem(storageKey, next));
    setStorageStatus(Result.isFailure(persisted) ? "unavailable" : "available");
    setPreferenceState(next);
  }, []);

  useEffect(() => {
    applyTheme(preference);
    document.documentElement.dataset.themeStorageStatus = storageStatus;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (preference === "system") {
        applyTheme("system");
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference, storageStatus]);

  const value = useMemo(
    () => ({ preference, setPreference, storageStatus }),
    [preference, setPreference, storageStatus],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Access the application-owned theme preference. */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return value;
}
