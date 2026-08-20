// Cliente HTTP fino para a API do Wtecc Historian (FastAPI + TimescaleDB).
// Tipos aqui espelham exatamente o shape snake_case retornado pela API —
// a conversão para os tipos "de UI" (camelCase, mais amigáveis) acontece
// em adapters.ts. Manter essa separação evita que uma mudança no schema
// do backend precise mexer em todos os componentes que consomem os dados.

import { getStoredToken, forceLogout } from "./auth-token";

const API_BASE = (import.meta.env["VITE_API_URL"] as string | undefined) ?? "http://localhost:8000";

export interface ApiPlc {
  id: number;
  name: string;
  brand: string;
  model: string;
  driver: string;
  ip_address: string;
  port: number | null;
  slot: number | null;
  rack: number | null;
  extra_config: Record<string, unknown>;
  poll_interval_ms: number;
  enabled: boolean;
  status: "online" | "offline" | "desconhecido";
  last_seen_at: string | null;
  last_error: string | null;
}

export interface ApiTag {
  id: number;
  plc_id: number;
  name: string;
  address: string;
  data_type: string;
  description: string | null;
  unit: string | null;
  logging_mode: string;
  deadband_value: number | null;
  trigger_tag_id: number | null;
  trigger_tag_name: string | null;
  trigger_condition: string | null;
  trigger_value: number | null;
  enabled: boolean;
  status: "online" | "offline" | "desconhecido";
}

export interface ApiTagListOut {
  items: ApiTag[];
  total: number;
}

export interface ApiTagCount {
  plc_id: number;
  count: number;
}

export interface ApiTagStats {
  total: number;
  enabled: number;
  by_logging_mode: Record<string, number>;
  by_plc: { plc_id: number; name: string; enabled_count: number }[];
}

export interface ApiCatalogEntry {
  models: string[];
  drivers: Record<string, string>;
  default_port: number;
}

export type ApiCatalog = Record<string, ApiCatalogEntry>;

export interface ApiStorageStats {
  approximate_row_count: number;
  events_last_24h: number;
  hypertable_size_bytes: number | null;
  oldest_event_at: string | null;
  newest_event_at: string | null;
  total_chunks: number | null;
  compressed_chunks: number | null;
  compression_ratio: number | null;
  plc_count: number;
  enabled_plc_count: number;
  tag_count: number;
  enabled_tag_count: number;
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...init,
    });
  } catch {
    throw new ApiError(
      `Não foi possível conectar à API em ${API_BASE}. Verifique se ela está rodando.`,
      0,
    );
  }

  if (res.status === 401) {
    forceLogout(); // sessão expirada/inválida — derruba pro login, sem esperar o usuário tentar de novo
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(body.detail ?? `Erro ${res.status} ao chamar ${path}`, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  login: (role: "viewer" | "operator" | "admin", password: string) =>
    request<{ token: string; role: "viewer" | "operator" | "admin"; expires_at: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ role, password }),
    }),
  listRoles: () =>
    request<{ role: "viewer" | "operator" | "admin"; has_password: boolean; updated_at: string | null }[]>(
      "/auth/roles"
    ),
  changeRolePassword: (role: "viewer" | "operator" | "admin", newPassword: string) =>
    request<{ ok: boolean }>(`/auth/roles/${role}/password`, {
      method: "PUT",
      body: JSON.stringify({ new_password: newPassword }),
    }),
  getCatalog: () => request<ApiCatalog>("/plcs/catalog"),

  listPlcs: () => request<ApiPlc[]>("/plcs"),
  createPlc: (payload: Record<string, unknown>) =>
    request<ApiPlc>("/plcs", { method: "POST", body: JSON.stringify(payload) }),
  updatePlc: (id: number, payload: Record<string, unknown>) =>
    request<ApiPlc>(`/plcs/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deletePlc: (id: number) => request<void>(`/plcs/${id}`, { method: "DELETE" }),

  listTags: (plcId?: number) =>
    request<ApiTag[]>(plcId ? `/tags?plc_id=${plcId}` : "/tags"),
  searchTags: (params: {
    plcId?: string | undefined;
    area?: "registered" | "trigger" | undefined;
    loggingMode?: string | undefined;
    dataType?: string | undefined;
    q?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }) => {
    const qs = new URLSearchParams();
    if (params.plcId) qs.set("plc_id", params.plcId);
    if (params.area) qs.set("area", params.area);
    if (params.loggingMode) qs.set("logging_mode", params.loggingMode);
    if (params.dataType) qs.set("data_type", params.dataType);
    if (params.q) qs.set("q", params.q);
    qs.set("limit", String(params.limit ?? 50));
    qs.set("offset", String(params.offset ?? 0));
    return request<ApiTagListOut>(`/tags/search?${qs.toString()}`);
  },
  getTagCounts: () => request<ApiTagCount[]>("/tags/counts"),
  getTagStats: () => request<ApiTagStats>("/tags/stats"),
  browseTags: (plcId: string, q: string) =>
    request<{ items: { name: string; data_type: string; is_array: boolean }[]; total_no_controlador: number; total_encontrado: number }>(
      `/plcs/${plcId}/browse-tags?${new URLSearchParams({ q })}`
    ),
  createTag: (payload: Record<string, unknown>) =>
    request<ApiTag>("/tags", { method: "POST", body: JSON.stringify(payload) }),
  updateTag: (id: number, payload: Record<string, unknown>) =>
    request<ApiTag>(`/tags/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteTag: (id: number) => request<void>(`/tags/${id}`, { method: "DELETE" }),

  getStorageStats: () => request<ApiStorageStats>("/storage/stats"),

  // Reinício manual do coletor (ver app/routers/system.py) — usado quando o
  // operador precisa forçar uma reconexão de propósito (tag nova criada no
  // CLP, coletor parece travado). Não é mais automático.
  restartCollector: () =>
    request<{ ok: boolean; container: string }>("/system/restart-collector", { method: "POST" }),
};

export { ApiError };
