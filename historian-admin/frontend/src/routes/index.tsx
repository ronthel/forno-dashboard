import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Activity, ArrowRight, Cpu, Database, Filter, Tags } from "lucide-react";
import { AppShell } from "@/components/historian/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useHistorian, useTagStats, useTagsSearch } from "@/lib/historian-store";
import { describeRule, getDriver } from "@/lib/historian-types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Wtecc Historian — Painel de gerenciamento industrial" },
      {
        name: "description",
        content:
          "Painel do Wtecc Historian: cadastro de CLPs Rockwell, Siemens e Schneider, tags e regras de filtragem condicional para históricos de processo.",
      },
      { property: "og:title", content: "Wtecc Historian — Painel de gerenciamento" },
      {
        property: "og:description",
        content:
          "Gerencie CLPs, drivers e regras de gravação condicional do seu historiador de processo.",
      },
    ],
  }),
  component: Dashboard,
});

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          {label}
        </p>
        <Icon className="size-4 text-primary" />
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

const MODE_LABELS: Record<string, string> = {
  cyclic: "Sempre (raw)",
  cos: "Mudança de estado",
  deadband: "Por variação (deadband)",
  conditional: "Disparo por outra tag",
  none: "Gatilho (nunca grava)",
  compression: "Compressão (PI)",
};

function Dashboard() {
  const { plcs } = useHistorian();
  const { data: tagStats } = useTagStats();
  // amostra pequena só pra ilustrar o painel — a lista completa fica na tela de Tags
  const { tags: sampleTags } = useTagsSearch({ area: "registered", page: 0, pageSize: 12 });

  const online = plcs.filter((p) => p.status === "online").length;
  const modeCounts = tagStats?.by_logging_mode ?? {};
  const total = tagStats?.total ?? 0;
  const enabled = tagStats?.enabled ?? 0;

  const byMode = Object.entries(MODE_LABELS).map(([key, label]) => ({
    key,
    label,
    count: modeCounts[key] ?? 0,
  }));
  const maxCount = Math.max(1, ...byMode.map((b) => b.count));

  // Estimativa aproximada (agregada por CLP/regra, não por tag individual
  // — com milhares de tags, calcular isso no navegador tag a tag é caro).
  const enabledPlcs = plcs.filter((p) => p.enabled);
  const rawPerSec = enabledPlcs.reduce((acc, p) => {
    const n = tagStats?.by_plc.find((b) => String(b.plc_id) === p.id)?.enabled_count ?? 0;
    return acc + n / (p.scanRateMs / 1000);
  }, 0);
  const avgScanHz =
    enabledPlcs.length > 0
      ? enabledPlcs.reduce((acc, p) => acc + 1 / (p.scanRateMs / 1000), 0) / enabledPlcs.length
      : 0;
  const storedPerSec =
    (modeCounts["cyclic"] ?? 0) * avgScanHz +
    ((modeCounts["deadband"] ?? 0) + (modeCounts["compression"] ?? 0) + (modeCounts["cos"] ?? 0)) *
      avgScanHz *
      0.05 +
    (modeCounts["conditional"] ?? 0) * avgScanHz * 0.02;

  const reduction = rawPerSec > 0 ? Math.round((1 - storedPerSec / rawPerSec) * 100) : 0;

  return (
    <AppShell
      title="Visão geral"
      subtitle="Estado da coleta, filtragem e gravação do histórico de processo."
      actions={
        <Button asChild>
          <Link to="/clps">
            Gerenciar CLPs <ArrowRight className="size-4" />
          </Link>
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={Cpu}
          label="Controladores"
          value={String(plcs.length)}
          hint={`${online} com comunicação confirmada · ${plcs.length - online} sem health-check`}
        />
        <Stat
          icon={Tags}
          label="Tags configuradas"
          value={total.toLocaleString("pt-BR")}
          hint={`${enabled.toLocaleString("pt-BR")} habilitadas para gravação`}
        />
        <Stat
          icon={Activity}
          label="Leituras / s"
          value={rawPerSec.toFixed(1)}
          hint="Volume bruto vindo dos drivers (estimativa)"
        />
        <Stat
          icon={Database}
          label="Gravações / s"
          value={storedPerSec.toFixed(1)}
          hint={`Redução estimada de ${reduction}% pelas regras`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <section className="panel p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Distribuição das regras</h2>
          </div>
          <div className="mt-4 space-y-3">
            {byMode.map((b) => (
              <div key={b.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{b.label}</span>
                  <span className="font-mono text-foreground">{b.count.toLocaleString("pt-BR")}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${(b.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel p-5 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Controladores</h2>
            <Link to="/clps" className="text-xs text-primary hover:underline">
              ver todos
            </Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {plcs.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {getDriver(p.driver).vendor} {p.model} ·{" "}
                    {p.config["host"] ?? p.config["endpoint"] ?? "—"} · {p.scanRateMs} ms
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={
                    p.status === "online"
                      ? "border-signal/40 text-signal"
                      : p.status === "degradado"
                        ? "border-warn/40 text-warn"
                        : "border-border text-muted-foreground"
                  }
                >
                  {p.status === "desconhecido" ? "não verificado" : p.status}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel mt-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Regras de gravação ativas</h2>
          <Link to="/tags" className="text-xs text-primary hover:underline">
            ver todas as {total.toLocaleString("pt-BR")} tags
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sampleTags.map((t) => (
            <div key={t.id} className="rounded-md border border-border bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-mono text-sm text-foreground">{t.name}</p>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {t.dataType}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-primary">{describeRule(t, sampleTags)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {plcs.find((p) => p.id === t.plcId)?.name ?? "—"} · retenção {t.retentionDays}d
              </p>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
