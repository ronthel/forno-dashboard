import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useHistorian, useHistorianActions, useTagsSearch } from "@/lib/historian-store";
import {
  EDGE_LABELS,
  TRIGGER_HELP,
  TRIGGER_LABELS,
  type DataType,
  type EdgeMode,
  type Tag,
  type TriggerMode,
} from "@/lib/historian-types";

const DATA_TYPES: DataType[] = ["BOOL", "INT", "DINT", "REAL", "STRING"];

const emptyTag = (plcId: string, trigger: TriggerMode = "on_change"): Omit<Tag, "id"> => ({
  plcId,
  name: "",
  address: "",
  dataType: trigger === "never" ? "BOOL" : "REAL",
  unit: "",
  trigger,
  deadband: 0.5,
  deadbandMode: "absoluto",
  intervalMs: 1000,
  triggerTagId: "",
  edge: "rising",
  expression: "",
  retentionDays: 365,
  enabled: true,
});

export function TagDialog({
  open,
  onOpenChange,
  tag,
  cloneFrom,
  defaultPlcId,
  defaultTrigger,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tag: Tag | null;
  /** Quando informada (e `tag` é null), pré-preenche o formulário com os
   * valores desta tag pra criar uma nova a partir dela — nome e endereço
   * vêm com um sinalizador de que precisam ser ajustados, já que o backend
   * rejeita nome ou endereço repetidos no mesmo CLP. */
  cloneFrom?: Tag | null;
  defaultPlcId?: string;
  defaultTrigger?: TriggerMode;
}) {
  const { plcs } = useHistorian();
  const { saveTag } = useHistorianActions();
  const [form, setForm] = useState<Omit<Tag, "id"> & { id?: string }>(
    emptyTag(defaultPlcId ?? "", defaultTrigger),
  );
  const [saving, setSaving] = useState(false);
  const [triggerSearchInput, setTriggerSearchInput] = useState("");
  const [triggerSearch, setTriggerSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTriggerSearch(triggerSearchInput), 250);
    return () => clearTimeout(timer);
  }, [triggerSearchInput]);

  // Busca ao vivo de endereço no controlador — só Rockwell (CIP tem nome
  // simbólico; Siemens/Modbus não têm esse conceito no protocolo, então
  // continuam com o campo de texto livre de sempre).
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseSearchInput, setBrowseSearchInput] = useState("");
  const [browseSearch, setBrowseSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setBrowseSearch(browseSearchInput), 250);
    return () => clearTimeout(timer);
  }, [browseSearchInput]);

  useEffect(() => {
    if (!open) return;
    if (tag) {
      setForm({ ...tag });
    } else if (cloneFrom) {
      // Clona todos os campos, MENOS o id (isto vira uma tag nova, via
      // POST) — nome e endereço saem marcados como "(cópia)" pra deixar
      // óbvio que precisam mudar antes de salvar; o backend rejeita os dois
      // repetidos no mesmo CLP.
      const { id: _sourceId, ...rest } = cloneFrom;
      setForm({ ...rest, name: `${cloneFrom.name} (cópia)`, address: `${cloneFrom.address} (ajustar)` });
    } else {
      setForm(emptyTag(defaultPlcId ?? plcs[0]?.id ?? "", defaultTrigger));
    }
  }, [open, tag, cloneFrom, defaultPlcId, defaultTrigger, plcs]);

  // Candidatos a tag de gatilho: busca no servidor, escopada ao CLP e tipo
  // BOOL — com milhares de tags cadastradas, carregar tudo pra filtrar no
  // navegador (como era antes) travaria esse diálogo.
  const { tags: triggerCandidatesRaw } = useTagsSearch({
    plcId: form.plcId || undefined,
    dataType: "bool",
    q: triggerSearch || undefined,
    page: 0,
    pageSize: 50,
  });
  const boolTags = triggerCandidatesRaw.filter((t) => t.id !== tag?.id);

  const selectedPlc = plcs.find((p) => p.id === form.plcId);
  const isRockwellPlc = selectedPlc?.driver === "rockwell_logix";

  const { data: browseResult, isFetching: browseFetching } = useQuery({
    queryKey: ["browse-tags", form.plcId, browseSearch],
    queryFn: () => api.browseTags(form.plcId, browseSearch),
    enabled: isRockwellPlc && browseOpen && !!form.plcId,
    staleTime: 60_000,
  });

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Informe o nome da tag.");
      return;
    }
    if (!form.address.trim()) {
      toast.error("Informe o endereço da tag.");
      return;
    }
    if (!form.plcId) {
      toast.error("Selecione o CLP.");
      return;
    }
    if (form.trigger === "on_trigger" && !form.triggerTagId) {
      toast.error("Selecione a tag de gatilho.");
      return;
    }
    if (form.trigger === "on_condition" && !form.expression.trim()) {
      toast.error("Escreva a expressão da condição.");
      return;
    }
    setSaving(true);
    try {
      await saveTag(form);
      toast.success(tag ? "Tag atualizada." : "Tag cadastrada.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar a tag.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tag ? "Editar tag" : cloneFrom ? "Clonar tag" : "Nova tag"}</DialogTitle>
          <DialogDescription>
            {cloneFrom
              ? `Criando uma tag nova a partir de "${cloneFrom.name}". Ajuste o nome e o endereço — o Historian não deixa salvar com nome ou endereço iguais aos de outra tag do mesmo CLP.`
              : "A regra de filtragem decide o que vai para o banco — só o que passa é gravado."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>CLP</Label>
              <Select
                value={form.plcId}
                onValueChange={(v) => setForm((f) => ({ ...f, plcId: v, triggerTagId: "" }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {plcs.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tag-name">Nome</Label>
              <Input
                id="tag-name"
                maxLength={80}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Peso_Batelada"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="tag-addr">Endereço</Label>
              {isRockwellPlc ? (
                <Popover open={browseOpen} onOpenChange={setBrowseOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="justify-between font-mono text-sm font-normal"
                    >
                      {form.address || "Buscar tag no controlador…"}
                      <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Digite pra buscar…"
                        value={browseSearchInput}
                        onValueChange={setBrowseSearchInput}
                      />
                      <CommandList>
                        {browseFetching && (
                          <div className="py-4 text-center text-xs text-muted-foreground">
                            Buscando no controlador…
                          </div>
                        )}
                        {!browseFetching && (
                          <CommandEmpty>
                            {browseSearchInput
                              ? "Nenhuma tag encontrada com esse nome."
                              : "Digite pra buscar entre as tags do controlador."}
                          </CommandEmpty>
                        )}
                        <CommandGroup>
                          {browseResult?.items.map((t) => (
                            <CommandItem
                              key={t.name}
                              value={t.name}
                              onSelect={() => {
                                setForm((f) => ({ ...f, address: t.name }));
                                setBrowseOpen(false);
                              }}
                              className="font-mono text-xs"
                            >
                              <Check
                                className={cn(
                                  "mr-2 size-4",
                                  form.address === t.name ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {t.name}
                              <span className="ml-auto text-[10px] text-muted-foreground">
                                {t.data_type}
                                {t.is_array ? " · array" : ""}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                        {browseResult && browseResult.total_encontrado > browseResult.items.length && (
                          <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                            Mostrando {browseResult.items.length} de {browseResult.total_encontrado} —
                            refine a busca pra ver mais.
                          </p>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              ) : (
                <Input
                  id="tag-addr"
                  maxLength={120}
                  className="font-mono text-sm"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="DB1,DBD250"
                />
              )}
              {isRockwellPlc && (
                <p className="text-[11px] text-muted-foreground">
                  Tags do próprio array (ex: TESTE_HIST) precisam do índice colocado à mão, ex:{" "}
                  <span className="font-mono">TESTE_HIST[0]</span>.
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Tipo</Label>
              <Select
                value={form.dataType}
                onValueChange={(v) => setForm((f) => ({ ...f, dataType: v as DataType }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATA_TYPES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="tag-unit">Unidade de engenharia</Label>
              <Input
                id="tag-unit"
                maxLength={16}
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                placeholder="kg, °C, bar…"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tag-ret">Retenção (dias)</Label>
              <Input
                id="tag-ret"
                type="number"
                min={1}
                max={7300}
                value={form.retentionDays}
                onChange={(e) =>
                  setForm((f) => ({ ...f, retentionDays: Number(e.target.value) || 365 }))
                }
              />
            </div>
          </div>

          <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="grid gap-1.5">
              <Label>Regra de filtragem</Label>
              <Select
                value={form.trigger}
                onValueChange={(v) => setForm((f) => ({ ...f, trigger: v as TriggerMode }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TRIGGER_LABELS) as TriggerMode[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {TRIGGER_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{TRIGGER_HELP[form.trigger]}</p>
            </div>

            {(form.trigger === "on_change" || form.trigger === "compression") && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="tag-db">
                    {form.trigger === "compression" ? "Desvio da reta (±)" : "Faixa morta"}
                  </Label>
                  <Input
                    id="tag-db"
                    type="number"
                    step="0.01"
                    min={0}
                    value={form.deadband}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, deadband: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
                {form.trigger === "on_change" && (
                <div className="grid gap-1.5">
                  <Label>Modo</Label>
                  <Select
                    value={form.deadbandMode}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, deadbandMode: v as Tag["deadbandMode"] }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="absoluto">Absoluto</SelectItem>
                      <SelectItem value="percentual">Percentual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                )}
                {form.trigger === "compression" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="tag-maxtime">Intervalo máximo (s)</Label>
                  <Input
                    id="tag-maxtime"
                    type="number"
                    min={0}
                    placeholder="sem limite"
                    value={form.compressionMaxTimeS ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        compressionMaxTimeS: e.target.value ? Number(e.target.value) : undefined,
                      }))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Grava mesmo sem sair da tolerância, no máximo a cada X segundos. Vazio = sem limite.
                  </p>
                </div>
                )}
              </div>
            )}

            {form.trigger === "on_interval" && (
              <div className="mt-3 grid gap-1.5">
                <Label htmlFor="tag-int">Intervalo de amostragem (ms)</Label>
                <Input
                  id="tag-int"
                  type="number"
                  min={100}
                  max={86400000}
                  value={form.intervalMs}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, intervalMs: Number(e.target.value) || 1000 }))
                  }
                />
              </div>
            )}

            {form.trigger === "on_trigger" && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Tag de gatilho (BOOL)</Label>
                  <Input
                    className="mb-1 text-xs"
                    placeholder="Buscar por nome…"
                    maxLength={80}
                    value={triggerSearchInput}
                    onChange={(e) => setTriggerSearchInput(e.target.value)}
                  />
                  <Select
                    value={form.triggerTagId}
                    onValueChange={(v) => setForm((f) => ({ ...f, triggerTagId: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {boolTags.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-muted-foreground">
                          {form.plcId
                            ? "Nenhuma tag BOOL encontrada — ajuste a busca ou cadastre uma."
                            : "Selecione o CLP primeiro."}
                        </div>
                      ) : (
                        boolTags.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Transição</Label>
                  <Select
                    value={form.edge}
                    onValueChange={(v) => setForm((f) => ({ ...f, edge: v as EdgeMode }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(EDGE_LABELS) as EdgeMode[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {EDGE_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {form.trigger === "on_condition" && (
              <div className="mt-3 grid gap-1.5">
                <Label htmlFor="tag-expr">Expressão</Label>
                <Textarea
                  id="tag-expr"
                  rows={2}
                  maxLength={300}
                  className="font-mono text-sm"
                  value={form.expression}
                  onChange={(e) => setForm((f) => ({ ...f, expression: e.target.value }))}
                  placeholder="Caldeira_Rodando == 1 AND Pressao_Vapor > 2.5"
                />
                <p className="text-xs text-muted-foreground">
                  Use nomes de tags do mesmo CLP com os operadores AND, OR, NOT, ==, !=, &gt;,
                  &lt;.
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Salvando…" : tag ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
