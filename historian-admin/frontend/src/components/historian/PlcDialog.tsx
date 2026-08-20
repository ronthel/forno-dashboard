import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { useHistorianActions } from "@/lib/historian-store";
import { DRIVERS, getDriver, type DriverId, type Plc } from "@/lib/historian-types";

const emptyPlc = (): Omit<Plc, "id"> => ({
  name: "",
  driver: "rockwell_logix",
  model: "CompactLogix",
  area: "",
  scanRateMs: 1000,
  enabled: true,
  status: "desconhecido",
  config: { host: "", slot: "0", batch_size: "40" },
});

export function PlcDialog({
  open,
  onOpenChange,
  plc,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plc: Plc | null;
}) {
  const { savePlc } = useHistorianActions();
  const [form, setForm] = useState<Omit<Plc, "id"> & { id?: string }>(emptyPlc());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(plc ? { ...plc } : emptyPlc());
  }, [open, plc]);

  const driver = getDriver(form.driver);

  const changeDriver = (id: DriverId) => {
    const d = getDriver(id);
    const config: Record<string, string> = {};
    d.fields.forEach((f) => (config[f.key] = f.defaultValue ?? ""));
    setForm((f) => ({ ...f, driver: id, model: d.models[0] ?? "", config }));
  };

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Informe o nome do CLP.");
      return;
    }
    const missing = driver.fields.find((f) => !String(form.config[f.key] ?? "").trim());
    if (missing) {
      toast.error(`Preencha o campo "${missing.label}".`);
      return;
    }
    setSaving(true);
    try {
      await savePlc(form);
      toast.success(plc ? "CLP atualizado." : "CLP cadastrado.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar o CLP.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{plc ? "Editar CLP" : "Novo CLP"}</DialogTitle>
          <DialogDescription>
            O driver define quais parâmetros de conexão são exigidos.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="plc-name">Nome</Label>
              <Input
                id="plc-name"
                maxLength={60}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Extrusora 01"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="plc-area">Área / Planta</Label>
              <Input
                id="plc-area"
                maxLength={60}
                value={form.area}
                onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                placeholder="Extrusão"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Driver de comunicação</Label>
            <Select value={form.driver} onValueChange={(v) => changeDriver(v as DriverId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DRIVERS.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.vendor} — {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{driver.description}</p>
            <p className="font-mono text-[11px] text-primary">{driver.library}</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Modelo</Label>
              <Select
                value={form.model}
                onValueChange={(v) => setForm((f) => ({ ...f, model: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {driver.models.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="plc-scan">Scan rate (ms)</Label>
              <Input
                id="plc-scan"
                type="number"
                min={100}
                max={600000}
                value={form.scanRateMs}
                onChange={(e) =>
                  setForm((f) => ({ ...f, scanRateMs: Number(e.target.value) || 1000 }))
                }
              />
            </div>
          </div>

          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="mb-3 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              Parâmetros do driver
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {driver.fields.map((f) => (
                <div key={f.key} className="grid gap-1.5">
                  <Label htmlFor={`cfg-${f.key}`}>{f.label}</Label>
                  {f.type === "select" ? (
                    <Select
                      value={form.config[f.key] ?? f.defaultValue ?? ""}
                      onValueChange={(v) =>
                        setForm((s) => ({ ...s, config: { ...s.config, [f.key]: v } }))
                      }
                    >
                      <SelectTrigger id={`cfg-${f.key}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {f.options?.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`cfg-${f.key}`}
                      type={f.type}
                      maxLength={80}
                      placeholder={f.placeholder}
                      value={form.config[f.key] ?? ""}
                      onChange={(e) =>
                        setForm((s) => ({
                          ...s,
                          config: { ...s.config, [f.key]: e.target.value },
                        }))
                      }
                    />
                  )}
                  {f.help ? <p className="text-xs text-muted-foreground">{f.help}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Salvando…" : plc ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
