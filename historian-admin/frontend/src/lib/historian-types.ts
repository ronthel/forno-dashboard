export type DriverId =
  | "rockwell_logix"
  | "rockwell_pccc"
  | "siemens_s7"
  | "schneider_modbus"
  | "opcua";

export type FieldType = "text" | "number" | "select";

export interface DriverField {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: string[];
  defaultValue?: string;
  help?: string;
}

export interface DriverDef {
  id: DriverId;
  vendor: string;
  label: string;
  description: string;
  library: string;
  models: string[];
  fields: DriverField[];
}

export const DRIVERS: DriverDef[] = [
  {
    id: "rockwell_logix",
    vendor: "Rockwell",
    label: "EtherNet/IP — Logix (CIP)",
    description:
      "Leitura simbólica de tags em controladores Logix. Suporta leitura multi-tag por requisição.",
    library: "pycomm3.LogixDriver",
    models: ["CompactLogix", "ControlLogix", "Micro820", "Micro850"],
    fields: [
      { key: "host", label: "Endereço IP", type: "text", placeholder: "192.168.1.10" },
      { key: "slot", label: "Slot do processador", type: "number", defaultValue: "0" },
      {
        key: "batch_size",
        label: "Tags por requisição",
        type: "number",
        defaultValue: "40",
        help: "Agrupamento multi-tag: principal fator de desempenho do scan.",
      },
    ],
  },
  {
    id: "rockwell_pccc",
    vendor: "Rockwell",
    label: "PCCC / DF1 — SLC & MicroLogix",
    description:
      "Endereçamento por arquivo de dados (N7:0, B3:0/1, F8:2). Sem tags simbólicas.",
    library: "pycomm3.SLCDriver",
    models: ["MicroLogix 1100", "MicroLogix 1400", "SLC 500", "PLC-5"],
    fields: [
      { key: "host", label: "Endereço IP", type: "text", placeholder: "192.168.1.20" },
      {
        key: "transport",
        label: "Transporte",
        type: "select",
        options: ["EtherNet/IP", "Serial DF1"],
        defaultValue: "EtherNet/IP",
      },
      { key: "batch_size", label: "Tags por requisição", type: "number", defaultValue: "20" },
    ],
  },
  {
    id: "siemens_s7",
    vendor: "Siemens",
    label: "S7 comm (ISO-on-TCP)",
    description: "Leitura de Data Blocks, Merkers, Inputs e Outputs via protocolo S7.",
    library: "python-snap7",
    models: ["S7-1200", "S7-1500", "S7-300", "S7-400"],
    fields: [
      { key: "host", label: "Endereço IP", type: "text", placeholder: "192.168.1.30" },
      { key: "rack", label: "Rack", type: "number", defaultValue: "0" },
      { key: "slot", label: "Slot", type: "number", defaultValue: "1" },
    ],
  },
  {
    id: "schneider_modbus",
    vendor: "Schneider",
    label: "Modbus TCP",
    description: "Holding registers, input registers, coils e discrete inputs.",
    library: "pymodbus",
    models: ["M221", "M241", "M251", "M580", "Quantum"],
    fields: [
      { key: "host", label: "Endereço IP", type: "text", placeholder: "192.168.1.40" },
      { key: "port", label: "Porta TCP", type: "number", defaultValue: "502" },
      { key: "unit_id", label: "Unit ID", type: "number", defaultValue: "1" },
    ],
  },
  {
    id: "modbus_tcp",
    vendor: "Genérico",
    label: "Modbus TCP",
    description:
      "Holding registers, input registers, coils e discrete inputs — mesmo driver do Schneider acima, aqui sem amarrar a um fabricante específico. Funciona com qualquer equipamento que fale Modbus TCP padrão.",
    library: "pymodbus",
    models: ["WAGO", "Delta", "ABB", "Beckhoff", "Weg", "Outro (Modbus TCP genérico)"],
    fields: [
      { key: "host", label: "Endereço IP", type: "text", placeholder: "192.168.1.60" },
      { key: "port", label: "Porta TCP", type: "number", defaultValue: "502" },
      { key: "unit_id", label: "Unit ID", type: "number", defaultValue: "1" },
    ],
  },
  {
    id: "opcua",
    vendor: "Genérico",
    label: "OPC UA",
    description:
      "Consome qualquer servidor OPC UA por subscription. Camada de normalização multi-fabricante.",
    library: "asyncua",
    models: ["Servidor OPC UA"],
    fields: [
      {
        key: "endpoint",
        label: "Endpoint",
        type: "text",
        placeholder: "opc.tcp://192.168.1.50:4840",
      },
      {
        key: "security",
        label: "Política de segurança",
        type: "select",
        options: ["None", "Basic256Sha256 / Sign", "Basic256Sha256 / SignAndEncrypt"],
        defaultValue: "None",
      },
    ],
  },
];

export const getDriver = (id: DriverId) => DRIVERS.find((d) => d.id === id)!;

export type PlcStatus = "online" | "offline" | "degradado" | "desconhecido";

export interface Plc {
  id: string;
  name: string;
  driver: DriverId;
  model: string;
  area: string;
  scanRateMs: number;
  enabled: boolean;
  status: PlcStatus;
  config: Record<string, string>;
}

export type DataType = "BOOL" | "INT" | "DINT" | "REAL" | "STRING";

export type TriggerMode =
  | "always"
  | "on_change"
  | "on_interval"
  | "on_trigger"
  | "on_condition"
  | "never"
  | "compression";

export const TRIGGER_LABELS: Record<TriggerMode, string> = {
  always: "Sempre (raw)",
  on_change: "Por variação (deadband)",
  on_interval: "Intervalo fixo",
  on_trigger: "Disparo por outra tag",
  on_condition: "Condição booleana",
  never: "Nunca (somente gatilho)",
  compression: "Exceção/Compressão (estilo PI)",
};

export const TRIGGER_HELP: Record<TriggerMode, string> = {
  always: "Grava todo valor lido. Use apenas para tags críticas de baixo volume.",
  on_change: "Grava somente quando o valor sai da faixa morta em relação ao último gravado.",
  on_interval: "Amostragem periódica independente de variação.",
  on_trigger: "Grava o valor no instante em que a tag de gatilho faz a transição escolhida.",
  on_condition: "Grava enquanto a expressão booleana sobre outras tags for verdadeira.",
  never:
    "Nunca grava histórico próprio — só é lida a cada ciclo para servir de gatilho de outras tags (ex: um pulso de disparo).",
  compression:
    "Algoritmo swinging-door (o mesmo princípio do OSIsoft PI): olha a tendência da reta, não só o último valor gravado. Comprime rampas lineares e ruído com muito menos pontos, preservando a forma real do sinal.",
};

export type EdgeMode = "rising" | "falling" | "both";

export const EDGE_LABELS: Record<EdgeMode, string> = {
  rising: "Borda de subida (0 → 1)",
  falling: "Borda de descida (1 → 0)",
  both: "Ambas as bordas",
};

export interface Tag {
  id: string;
  plcId: string;
  name: string;
  address: string;
  dataType: DataType;
  unit: string;
  trigger: TriggerMode;
  deadband: number;
  deadbandMode: "absoluto" | "percentual";
  intervalMs: number;
  triggerTagId: string;
  triggerTagName?: string | undefined;
  compressionMaxTimeS?: number | undefined;
  status?: "online" | "offline" | "desconhecido" | undefined;
  edge: EdgeMode;
  expression: string;
  retentionDays: number;
  enabled: boolean;
}

export function describeRule(tag: Tag, tags: Tag[]): string {
  switch (tag.trigger) {
    case "always":
      return "Grava todo valor lido";
    case "on_change":
      return `Variação > ${tag.deadband}${tag.deadbandMode === "percentual" ? "%" : ` ${tag.unit || ""}`.trimEnd()}`;
    case "on_interval":
      return `A cada ${tag.intervalMs} ms`;
    case "on_trigger": {
      const name = tag.triggerTagName ?? tags.find((t) => t.id === tag.triggerTagId)?.name;
      const edge = tag.edge === "rising" ? "0 → 1" : tag.edge === "falling" ? "1 → 0" : "0 ↔ 1";
      return `Quando ${name ?? "—"} ${edge}`;
    }
    case "on_condition":
      return tag.expression || "Expressão não definida";
    case "never":
      return "Nunca grava — só serve de gatilho para outra tag";
    case "compression":
      return `Compressão (swinging-door), desvio ±${tag.deadband}${
        tag.compressionMaxTimeS ? ` · máx. ${tag.compressionMaxTimeS}s` : ""
      }`;
  }
}
