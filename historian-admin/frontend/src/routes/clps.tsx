import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/historian/AppShell";
import { PlcDialog } from "@/components/historian/PlcDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useHistorian, useHistorianActions, useTagCounts } from "@/lib/historian-store";
import { useAuth } from "@/lib/auth-store";
import { DRIVERS, getDriver, type Plc } from "@/lib/historian-types";

export const Route = createFileRoute("/clps")({
  head: () => ({
    meta: [
      { title: "CLPs e drivers — Wtecc Historian" },
      {
        name: "description",
        content:
          "Cadastre controladores Rockwell CompactLogix e MicroLogix, Siemens S7, Schneider Modbus e servidores OPC UA no Wtecc Historian.",
      },
      { property: "og:title", content: "CLPs e drivers — Wtecc Historian" },
      {
        property: "og:description",
        content: "Cadastro de controladores e parâmetros de driver por fabricante.",
      },
    ],
  }),
  component: PlcsPage,
});

function PlcsPage() {
  const { plcs } = useHistorian();
  const { countByPlc } = useTagCounts();
  const { togglePlc, deletePlc, restartCollector } = useHistorianActions();
  const { hasRole } = useAuth();
  const canManage = hasRole("admin"); // criar/editar/excluir/habilitar CLP é ação estrutural — só admin
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plc | null>(null);
  const [restarting, setRestarting] = useState(false);

  // Reinício manual do coletor — decisão deliberada de NÃO reconectar
  // automaticamente dentro do driver (isso já causou instabilidade em
  // produção). É sempre uma ação explícita disparada por um admin aqui.
  const handleRestartCollector = async () => {
    setRestarting(true);
    try {
      await restartCollector();
      toast.success("Coletor reiniciado — reconectando ao(s) CLP(s)...");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reiniciar o coletor.");
    } finally {
      setRestarting(false);
    }
  };

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  return (
    <AppShell
      title="CLPs & Drivers"
      subtitle="Cada controlador usa um driver plugável que define seus parâmetros de conexão."
      actions={
        canManage ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleRestartCollector}
              disabled={restarting}
              title="Força o coletor a reconectar em todos os CLPs — use se uma tag nova não aparecer, ou se os dados pararem de chegar"
            >
              <RefreshCw className={`size-4 ${restarting ? "animate-spin" : ""}`} />
              {restarting ? "Reiniciando..." : "Reiniciar coletor"}
            </Button>
            <Button onClick={openNew}>
              <Plus className="size-4" /> Novo CLP
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {DRIVERS.map((d) => (
          <div key={d.id} className="panel p-4">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="text-[10px]">
                {d.vendor}
              </Badge>
              <span className="font-mono text-[10px] text-muted-foreground">
                {plcs.filter((p) => p.driver === d.id).length} CLP(s)
              </span>
            </div>
            <p className="mt-2 text-sm font-medium">{d.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{d.description}</p>
            <p className="mt-2 font-mono text-[11px] text-primary">{d.library}</p>
          </div>
        ))}
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Controlador</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Conexão</TableHead>
              <TableHead>Scan</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plcs.map((p) => {
              const d = getDriver(p.driver);
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.area || "—"}</p>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">
                      {d.vendor} · {p.model}
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">{d.library}</p>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.config["host"] ?? p.config["endpoint"] ?? "—"}
                    {p.config["slot"] !== undefined ? ` /s${p.config["slot"]}` : ""}
                    {p.config["unit_id"] !== undefined ? ` /u${p.config["unit_id"]}` : ""}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.scanRateMs} ms</TableCell>
                  <TableCell className="font-mono text-xs">
                    {countByPlc.get(p.id) ?? 0}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={p.enabled}
                        disabled={!canManage}
                        onCheckedChange={() =>
                          togglePlc(p).catch((e: Error) => toast.error(e.message))
                        }
                        aria-label={`Habilitar ${p.name}`}
                      />
                      <span
                        className={`inline-block size-2 rounded-full ${
                          p.status === "online"
                            ? "bg-signal"
                            : p.status === "offline"
                              ? "bg-destructive"
                              : "bg-muted-foreground/40"
                        }`}
                        aria-hidden="true"
                      />
                      <span
                        className={
                          p.status === "online"
                            ? "text-xs text-signal"
                            : p.status === "offline"
                              ? "text-xs text-destructive"
                              : "text-xs text-muted-foreground"
                        }
                        title={
                          p.status === "desconhecido"
                            ? "Sem heartbeat do coletor ainda — CLP novo ou driver sem implementação"
                            : undefined
                        }
                      >
                        {p.status === "desconhecido"
                          ? "não verificado"
                          : p.status === "online"
                            ? "conectado"
                            : "fora do ar"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {canManage ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Editar"
                          onClick={() => {
                            setEditing(p);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Excluir"
                          onClick={() =>
                            deletePlc(p.id)
                              .then(() => toast.success("CLP excluído."))
                              .catch((e: Error) => toast.error(e.message))
                          }
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">somente leitura</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <PlcDialog open={open} onOpenChange={setOpen} plc={editing} />
    </AppShell>
  );
}
