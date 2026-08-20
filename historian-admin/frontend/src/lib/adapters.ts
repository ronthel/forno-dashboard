// Conversão entre os tipos "de UI" (historian-types.ts) e o formato que a
// API do Wtecc Historian espera/retorna (api-client.ts). Fica tudo aqui
// para que uma mudança no schema do backend não precise ser rastreada
// componente por componente.

import type { ApiPlc, ApiTag } from "./api-client";
import {
  DRIVERS,
  type DataType,
  type DriverId,
  type EdgeMode,
  type Plc,
  type Tag,
  type TriggerMode,
} from "./historian-types";

// ============================================================
// PLC
// ============================================================

function driverFields(driverId: string) {
  return DRIVERS.find((d) => d.id === driverId)?.fields ?? [];
}

// Cada driver tem um campo "de endereço principal" diferente (host vs.
// endpoint no caso do OPC UA) — é ele que mapeia para a coluna ip_address
// da API. Os demais campos do driver (slot, rack, port já têm colunas
// próprias; o resto vai para extra_config).
function primaryAddressKey(driverId: string): string {
  const fields = driverFields(driverId);
  return fields.find((f) => f.key === "host" || f.key === "endpoint")?.key ?? "host";
}

const PLC_OWN_COLUMNS = new Set(["slot", "rack", "port"]);

function driverToBrand(driver: DriverId): string {
  switch (driver) {
    case "rockwell_logix":
    case "rockwell_pccc":
      return "rockwell";
    case "siemens_s7":
      return "siemens";
    case "schneider_modbus":
      return "schneider";
    case "modbus_tcp":
      return "modbus";
    case "opcua":
      return "generic";
  }
}

function numOrUndefined(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function fromApiPlc(p: ApiPlc): Plc {
  const addressKey = primaryAddressKey(p.driver);
  const config: Record<string, string> = {};

  const extra = p.extra_config && typeof p.extra_config === "object" ? p.extra_config : {};
  for (const [k, v] of Object.entries(extra)) {
    config[k] = v === undefined || v === null ? "" : String(v);
  }

  config[addressKey] = p.ip_address;
  if (p.slot !== null && p.slot !== undefined) config["slot"] = String(p.slot);
  if (p.rack !== null && p.rack !== undefined) config["rack"] = String(p.rack);
  if (p.port !== null && p.port !== undefined) config["port"] = String(p.port);

  return {
    id: String(p.id),
    name: p.name,
    driver: p.driver as DriverId,
    model: p.model,
    area: "", // backend ainda não tem esse campo
    scanRateMs: p.poll_interval_ms,
    enabled: p.enabled,
    status: p.status, // "online" | "offline" | "desconhecido" — vem do heartbeat do coletor
    config,
  };
}

export function toApiPlc(plc: Omit<Plc, "id"> & { id?: string }): Record<string, unknown> {
  const addressKey = primaryAddressKey(plc.driver);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(plc.config)) {
    if (k !== addressKey && !PLC_OWN_COLUMNS.has(k)) extra[k] = v;
  }

  return {
    name: plc.name,
    brand: driverToBrand(plc.driver),
    model: plc.model,
    driver: plc.driver,
    ip_address: plc.config[addressKey] ?? "",
    port: numOrUndefined(plc.config["port"]),
    slot: numOrUndefined(plc.config["slot"]),
    rack: numOrUndefined(plc.config["rack"]),
    extra_config: extra,
    poll_interval_ms: plc.scanRateMs,
    enabled: plc.enabled,
  };
}

// ============================================================
// Tag
// ============================================================

function mapLoggingModeFromApi(t: ApiTag): {
  trigger: TriggerMode;
  deadband: number;
  triggerTagId: string;
  edge: EdgeMode;
  compressionMaxTimeS?: number | undefined;
} {
  switch (t.logging_mode) {
    case "cyclic":
      return { trigger: "always", deadband: 0, triggerTagId: "", edge: "rising" };
    case "deadband":
      return {
        trigger: "on_change",
        deadband: t.deadband_value ?? 0,
        triggerTagId: "",
        edge: "rising",
      };
    case "compression":
      return {
        trigger: "compression",
        deadband: t.deadband_value ?? 0,
        triggerTagId: "",
        edge: "rising",
        compressionMaxTimeS: t.trigger_value ?? undefined,
      };
    case "conditional": {
      const edge: EdgeMode =
        t.trigger_condition === "1->0"
          ? "falling"
          : t.trigger_condition === "any_change"
            ? "both"
            : "rising";
      return {
        trigger: "on_trigger",
        deadband: 0,
        triggerTagId: t.trigger_tag_id !== null ? String(t.trigger_tag_id) : "",
        edge,
      };
    }
    case "none":
      return { trigger: "never", deadband: 0, triggerTagId: "", edge: "rising" };
    default:
      // "cos" (mudança de estado pura) — mais próximo de "on_change" com deadband 0.
      // Só existe hoje se criado via API diretamente; a UI sempre grava "deadband".
      return { trigger: "on_change", deadband: 0, triggerTagId: "", edge: "rising" };
  }
}
export function fromApiTag(t: ApiTag): Tag {
  const mode = mapLoggingModeFromApi(t);
  return {
    id: String(t.id),
    plcId: String(t.plc_id),
    name: t.name,
    address: t.address,
    dataType: t.data_type.toUpperCase() as DataType,
    unit: t.unit ?? "",
    trigger: mode.trigger,
    deadband: mode.deadband,
    deadbandMode: "absoluto",
    intervalMs: 1000,
    triggerTagId: mode.triggerTagId,
    triggerTagName: t.trigger_tag_name ?? undefined,
    compressionMaxTimeS: mode.compressionMaxTimeS,
    status: t.status,
    edge: mode.edge,
    expression: "",
    retentionDays: 365, // backend ainda não tem retenção por tag
    enabled: t.enabled,
  };
}

// Regras que a UI oferece mas o motor de coleta ainda não implementa.
// Lançar aqui em vez de gravar algo incorreto silenciosamente.
export function toApiTag(tag: Omit<Tag, "id"> & { id?: string }): Record<string, unknown> {
  const base = {
    plc_id: Number(tag.plcId),
    name: tag.name,
    address: tag.address,
    data_type: tag.dataType.toLowerCase(),
    unit: tag.unit || undefined,
    enabled: tag.enabled,
  };

  switch (tag.trigger) {
    case "always":
      return { ...base, logging_mode: "cyclic" };

    case "on_change":
      return { ...base, logging_mode: "deadband", deadband_value: tag.deadband };

    case "compression":
      return {
        ...base,
        logging_mode: "compression",
        deadband_value: tag.deadband,
        trigger_value: tag.compressionMaxTimeS ?? undefined,
      };

    case "on_trigger": {
      if (!tag.triggerTagId) throw new Error("Selecione a tag de gatilho.");
      const trigger_condition =
        tag.edge === "falling" ? "1->0" : tag.edge === "both" ? "any_change" : "0->1";
      return {
        ...base,
        logging_mode: "conditional",
        trigger_tag_id: Number(tag.triggerTagId),
        trigger_condition,
      };
    }

    case "on_interval":
      throw new Error(
        'A regra "Intervalo fixo" ainda não é suportada pelo motor de coleta do Wtecc Historian — use "Sempre" ou "Por variação" por enquanto.',
      );

    case "on_condition":
      throw new Error(
        'A regra "Condição booleana" (expressões compostas) ainda não é suportada pelo motor de coleta — use "Disparo por outra tag" para condições simples.',
      );

    case "never":
      return { ...base, logging_mode: "none" };
  }
}
