import { Link } from "@tanstack/react-router";
import { Activity, Cpu, Database, LogOut, Tags, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-store";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/", label: "Visão geral", icon: Activity },
  { to: "/clps", label: "CLPs & Drivers", icon: Cpu },
  { to: "/tags", label: "Tags & Regras", icon: Tags },
  { to: "/armazenamento", label: "Armazenamento", icon: Database },
] as const;

const ADMIN_NAV = { to: "/usuarios", label: "Usuários & Senhas", icon: Users } as const;

const ROLE_LABELS = { viewer: "Visualizador", operator: "Operador", admin: "Administrador" } as const;

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { role, logout, hasRole } = useAuth();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <img src="/logo-wtecc.png" alt="WTECC Automação" className="h-18 w-auto" />
          <div className="leading-tight">
            <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              Historian
            </p>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&.active]:bg-sidebar-accent [&.active]:font-medium [&.active]:text-primary"
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
          {hasRole("admin") && (
            <Link
              to={ADMIN_NAV.to}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&.active]:bg-sidebar-accent [&.active]:font-medium [&.active]:text-primary"
            >
              <ADMIN_NAV.icon className="size-4" />
              {ADMIN_NAV.label}
            </Link>
          )}
        </nav>

        <div className="mt-auto p-3">
          <div className="rounded-md border border-sidebar-border bg-surface p-3">
            <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              Ingest
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-signal">
              <span className="size-1.5 animate-pulse rounded-full bg-signal" />
              Operacional
            </p>
          </div>
          <div className="mt-2 flex items-center justify-between rounded-md border border-sidebar-border bg-surface px-3 py-2">
            <div className="leading-tight">
              <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                Sessão
              </p>
              <p className="text-xs text-sidebar-foreground">{role ? ROLE_LABELS[role] : "—"}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={logout} title="Sair" aria-label="Sair">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="grid-backdrop flex flex-wrap items-end justify-between gap-4 border-b border-border px-6 py-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {actions}
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
