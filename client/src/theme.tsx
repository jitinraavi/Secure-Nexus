import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";
interface ThemeContextValue { mode: ThemeMode; setMode: (mode: ThemeMode) => void; }
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try { const stored = localStorage.getItem("groundwork-theme"); return stored === "light" || stored === "system" ? stored : "dark"; }
    catch { return "dark"; }
  });
  useEffect(() => {
    try { localStorage.setItem("groundwork-theme", mode); } catch { /* Theme works without browser storage. */ }
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.documentElement.dataset.theme = mode === "system" ? (media.matches ? "light" : "dark") : mode;
    };
    apply();
    if (mode === "system") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
  }, [mode]);
  const value = useMemo(() => ({ mode, setMode }), [mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
