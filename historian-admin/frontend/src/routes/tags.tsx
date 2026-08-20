import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/historian/AppShell";
import { TagDialog } from "@/components/historian/TagDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useHistorian, useHistorianActions, useTagsSearch } from "@/lib/historian-store";
import { useAuth } from "@/lib/auth-store";
import { TRIGGER_LABELS, describeRule, type Tag, type TriggerMode } from "@/lib/historian-types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/tags")({
  head: () => ({
    meta: [
      { title: "Tags e regras de filtragem — Wtecc Historian" },
      {
        name: "description",
        content:
          "Configure regras de gravação condicional por tag: deadband, compressão por exceção, intervalo fixo, disparo por transição 0 para 1 e expressões booleanas entre variáveis.",
      },
      { property: "og:title", content: "Tags e regras de filtragem — Wtecc Historian" },
      {
        property: "og:description",
        content: "Gravação condicional de tags dependente de outras variáveis do processo.",
      },
    ],
  }),
  component: TagsPage,
});

const PAGE_SIZE = 50;

/** Debounce simples — evita disparar uma busca no servidor a cada tecla digitada. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function TagsPage() {
  const { plcs } = useHistorian();
  const { toggleTag, deleteTag } = useHistorianActions();
  const { hasRole } = useAuth();
  const canCreateOrDelete = hasRole("admin");
  const canEditOrToggle = hasRole("operator");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const query = useDebounced(queryInput, 300);
  const [plcFilter, setPlcFilter] = useState("all");
  const [ruleFilter, setRuleFilter] = useState("all");
  const [area, setArea] = useState<"registered" | "trigger">("registered");
  const [page, setPage] = useState(0);

  // qualquer mudança de filtro volta pra primeira página
  useEffect(() => setPage(0), [query, plcFilter, ruleFilter, area]);

  const { tags, total, isLoading, isFetching } = useTagsSearch({
    area,
    plcId: plcFilter !== "all" ? plcFilter : undefined,
    loggingMode: area === "registered" && ruleFilter !== "all" ? ruleFilter : undefined,
    q: query || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <AppShell
      title="Tags & Regras"
      subtitle="A regra define o que é gravado — inclusive gravação disparada por outra variável."
      actions={
        canCreateOrDelete ? (
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" /> Nova tag
          </Button>
        ) : undefined
      }
    >
      <Tabs value={area} onValueChange={(v) => setArea(v as "registered" | "trigger")} className="mb-4">
        <TabsList>
          <TabsTrigger value="registered">Tags registradas</TabsTrigger>
          <TabsTrigger value="trigger">Gatilhos (pulsos)</TabsTrigger>
        </TabsList>
      </Tabs>

      {area === "trigger" && (
        <p className="mb-4 text-xs text-muted-foreground">
          Tags no modo "Nunca (somente gatilho)" — nunca gravam histórico próprio, só servem pra
          disparar a gravação de outra tag em "Tags registradas".
        </p>
      )}

      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome ou endereço…"
            maxLength={80}
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
          />
        </div>
        <Select value={plcFilter} onValueChange={setPlcFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os CLPs</SelectItem>
            {plcs.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {area === "registered" && (
          <Select value={ruleFilter} onValueChange={setRuleFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as regras</SelectItem>
              {(Object.keys(TRIGGER_LABELS) as TriggerMode[])
                .filter((k) => k !== "never")
                .map((k) => (
                  <SelectItem key={k} value={k}>
                    {TRIGGER_LABELS[k]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Tag</TableHead>
              <TableHead>Endereço</TableHead>
              <TableHead>Tipo</TableHead>
              {area === "registered" && <TableHead>Regra de gravação</TableHead>}
              {area === "registered" && <TableHead>Retenção</TableHead>}
              <TableHead>Ativa</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block size-2 shrink-0 rounded-full ${
                        t.status === "online"
                          ? "bg-signal"
                          : t.status === "offline"
                            ? "bg-destructive"
                            : "bg-muted-foreground/40"
                      }`}
                      title={
                        t.status === "online"
                          ? "Lendo com sucesso"
                          : t.status === "offline"
                            ? "Falha na última leitura ou sem heartbeat recente"
                            : "Ainda sem heartbeat de leitura"
                      }
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-mono text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {plcs.find((p) => p.id === t.plcId)?.name ?? "—"}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{t.address}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-[10px]">
                    {t.dataType}
                    {t.unit ? ` · ${t.unit}` : ""}
                  </Badge>
                </TableCell>
                {area === "registered" && (
                  <TableCell>
                    <p className="text-xs text-primary">{TRIGGER_LABELS[t.trigger]}</p>
                    <p className="text-xs text-muted-foreground">{describeRule(t, tags)}</p>
                  </TableCell>
                )}
                {area === "registered" && (
                  <TableCell className="font-mono text-xs">{t.retentionDays}d</TableCell>
                )}
                <TableCell>
                  <Switch
                    checked={t.enabled}
                    disabled={!canEditOrToggle}
                    onCheckedChange={() =>
                      toggleTag(t).catch((e: Error) => toast.error(e.message))
                    }
                    aria-label={`Ativar ${t.name}`}
                  />
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {canEditOrToggle && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar"
                      onClick={() => {
                        setEditing(t);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  )}
                  {canCreateOrDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir"
                      onClick={() =>
                        deleteTag(t.id)
                          .then(() => toast.success("Tag excluída."))
                          .catch((e: Error) => toast.error(e.message))
                      }
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                  {!canEditOrToggle && !canCreateOrDelete && (
                    <span className="text-xs text-muted-foreground">somente leitura</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && tags.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={area === "registered" ? 7 : 5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Nenhuma tag encontrada com os filtros atuais.
                </TableCell>
              </TableRow>
            )}
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={area === "registered" ? 7 : 5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Carregando…
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <p>
          {total === 0
            ? "0 resultados"
            : `Mostrando ${rangeStart}–${rangeEnd} de ${total.toLocaleString("pt-BR")}`}
          {isFetching && !isLoading && <span className="ml-2 opacity-60">atualizando…</span>}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="size-4" /> Anterior
          </Button>
          <span className="font-mono">
            {page + 1} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Próxima <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <TagDialog
        open={open}
        onOpenChange={setOpen}
        tag={editing}
        {...(plcFilter !== "all" ? { defaultPlcId: plcFilter } : {})}
        {...(!editing ? { defaultTrigger: area === "trigger" ? "never" : "on_change" } : {})}
      />
    </AppShell>
  );
}
