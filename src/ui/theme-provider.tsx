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

type ThemeContextValue = {
  readonly preference: ThemePreference;
  readonly setPreference: (preference: ThemePreference) => void;
};

const storageKey = "overseer-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemePreference {
  const value = localStorage.getItem(storageKey);
  return value === "light" || value === "dark" ? value : "system";
}

function applyTheme(preference: ThemePreference): void {
  const resolved = preference === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

/** Own theme persistence and live operating-system preference changes. */
export function ThemeProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const setPreference = useCallback((next: ThemePreference) => {
    localStorage.setItem(storageKey, next);
    setPreferenceState(next);
  }, []);

  useEffect(() => {
    applyTheme(preference);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (preference === "system") {
        applyTheme("system");
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);
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
