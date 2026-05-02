import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "cartola-ia-theme";

type Ctx = { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void };
const ThemeCtx = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(KEY) as Theme | null;
    const initial: Theme = stored ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(initial);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  return (
    <ThemeCtx.Provider value={{ theme, setTheme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme deve estar dentro de ThemeProvider");
  return ctx;
}