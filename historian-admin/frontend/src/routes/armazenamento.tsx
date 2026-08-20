import { createFileRoute } from "@tanstack/react-router";
import { Database, HardDrive, Timer } from "lucide-react";
import { AppShell } from "@/components/historian/AppShell";
import { Badge } from "@/components/ui/badge";
import { useHistorian, useStorageStats } from "@/lib/historian-store";

export const Route = createFileRoute("/armazenamento")({
  head: () => ({
    meta: [
      { title: "Armazenamento e retenção — Wtecc Historian" },
      {
        name: "description",
        content:
          "Uso real do TimescaleDB no Wtecc Historian: linhas gravadas, tamanho em disco e taxa de compressão.",
      },
      { property: "og:title", content: "Armazenamento e retenção — Wtecc Historian" },
      {
        property: "og:description",
        content: "Hypertables, compressão e uso de disco no TimescaleDB.",
      },
    ],
  }),
  component: StoragePage,
});

const POLICIES = [
  {
    icon: Timer,
    title: "Particionamento por tempo",
    body: "Hypertable tag_events particionada em chunks (padrão de 7 dias, sem override no schema atual).",
  },
  {
    icon: Database,
    title: "Compressão após 7 dias",
    body: "Segmentação por tag_id e ordenação por time — a taxa real de compressão aparece abaixo.",
  },
  {
    icon: HardDrive,
    title: "Agregado contínuo",
    body: "View tag_events_hourly (min, máx, média, contagem) já configurada para consultas de longo prazo.",
  },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function StoragePage() {
  const { plcs } = useHistorian();
  const { data: stats, isLoading, isError } = useStorageStats();

  return (
    <AppShell
      title="Armazenamento"
      subtitle="PostgreSQL + TimescaleDB: uso real de disco, compressão e volume de eventos."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {POLICIES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="panel p-5">
            <Icon className="size-5 text-primary" />
            <p className="mt-3 text-sm font-semibold">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>

      <section className="panel mt-4 p-5">
        <h2 className="text-sm font-semibold">Uso atual</h2>

        {isError && (
          <p className="mt-3 text-xs text-destructive">
            Não foi possível carregar as métricas — confirme se a API e o TimescaleDB estão no ar.
          </p>
        )}

        {isLoading && !stats && (
          <p className="mt-3 text-xs text-muted-foreground">Carregando métricas do TimescaleDB…</p>
        )}

        {stats && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-border bg-surface-2 p-4">
              <p className="text-xs text-muted-foreground">Eventos gravados</p>
              <p className="mt-1 text-2xl font-semibold">
                {stats.approximate_row_count.toLocaleString("pt-BR")}
              </p>
              <p className="text-xs text-muted-foreground">contagem aproximada</p>
            </div>
            <div className="rounded-md border border-border bg-surface-2 p-4">
              <p className="text-xs text-muted-foreground">Últimas 24h</p>
              <p className="mt-1 text-2xl font-semibold">
                {stats.events_last_24h.toLocaleString("pt-BR")}
              </p>
              <p className="text-xs text-muted-foreground">eventos</p>
            </div>
            <div className="rounded-md border border-border bg-surface-2 p-4">
              <p className="text-xs text-muted-foreground">Tamanho em disco</p>
              <p className="mt-1 text-2xl font-semibold">
                {formatBytes(stats.hypertable_size_bytes)}
              </p>
              <p className="text-xs text-muted-foreground">hypertable tag_events</p>
            </div>
            <div className="rounded-md border border-border bg-surface-2 p-4">
              <p className="text-xs text-muted-foreground">Compressão</p>
              <p className="mt-1 text-2xl font-semibold">
                {stats.compression_ratio ? `${stats.compression_ratio}:1` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {stats.compressed_chunks}/{stats.total_chunks} chunks comprimidos
              </p>
            </div>
          </div>
        )}

        {stats && (
          <p className="mt-4 text-xs text-muted-foreground">
            Período coberto: {formatDate(stats.oldest_event_at)} até {formatDate(stats.newest_event_at)}
          </p>
        )}

        {stats && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="secondary">{plcs.length} controladores</Badge>
            <Badge variant="secondary">{stats.tag_count.toLocaleString("pt-BR")} tags</Badge>
            <Badge variant="secondary">
              {stats.enabled_tag_count.toLocaleString("pt-BR")} habilitadas
            </Badge>
          </div>
        )}
      </section>
    </AppShell>
  );
}
