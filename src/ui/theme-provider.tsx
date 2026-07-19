import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  readonly theme: Theme;
  readonly resolvedTheme: ResolvedTheme;
  readonly setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function parseTheme(value: string | null): Theme | null {
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

function initialTheme(): Theme {
  const urlTheme = parseTheme(new URL(window.location.href).searchParams.get("mode"));
  return urlTheme ?? parseTheme(localStorage.getItem("overseer-theme")) ?? "system";
}

function systemTheme(): ResolvedTheme {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Owns Overseer's persisted light, dark, and system theme policy. */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const resolvedTheme = theme === "system" ? system : theme;

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const updateSystem = () => setSystem(media.matches ? "dark" : "light");
    media.addEventListener("change", updateSystem);
    return () => media.removeEventListener("change", updateSystem);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
    localStorage.setItem("overseer-theme", theme);
    const url = new URL(window.location.href);
    url.searchParams.set("mode", theme);
    window.history.replaceState({}, "", url);
  }, [resolvedTheme, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [resolvedTheme, theme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

/** Read and update the application-owned theme preference. */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("useTheme must be called inside ThemeProvider");
  return value;
}
