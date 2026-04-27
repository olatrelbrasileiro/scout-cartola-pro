import { Link } from "@tanstack/react-router";
import { Trophy, BarChart3, Users, Sparkles } from "lucide-react";

const navItems = [
  { to: "/", label: "Mercado", icon: BarChart3 },
  { to: "/comparar", label: "Comparar", icon: Users },
  { to: "/escalacao", label: "Escalação IA", icon: Sparkles },
] as const;

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[image:var(--gradient-cta)] shadow-[var(--shadow-glow)]">
            <Trophy className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <div className="font-bold tracking-tight">Cartola IA</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              insights inteligentes
            </div>
          </div>
        </Link>

        <nav className="flex items-center gap-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&.active]:bg-muted [&.active]:text-foreground"
              activeProps={{ className: "active" }}
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}