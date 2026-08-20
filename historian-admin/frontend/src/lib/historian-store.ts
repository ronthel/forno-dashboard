import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api-client";
import { fromApiPlc, fromApiTag, toApiPlc, toApiTag } from "./adapters";
import type { Plc, Tag } from "./historian-types";

const PLCS_KEY = ["plcs"] as const;
const TAGS_SEARCH_KEY = ["tags-search"] as const;
const TAG_COUNTS_KEY = ["tag-counts"] as const;
const TAG_STATS_KEY = ["tag-stats"] as const;
const STORAGE_STATS_KEY = ["storage-stats"] as const;

/**
 * Métricas reais de uso do TimescaleDB (linhas gravadas, tamanho em disco,
 * compressão) — usado pela tela de Armazenamento. Atualiza a cada 30s
 * porque esses números mudam continuamente enquanto o coletor está ativo.
 */
export function useStorageStats() {
  return useQuery({
    queryKey: STORAGE_STATS_KEY,
    queryFn: () => api.getStorageStats(),
    refetchInterval: 30_000,
  });
}

/**
 * Leitura de CLPs — usada por praticamente toda tela. Não inclui mais
 * tags: com milhares de tags cadastradas, buscar tudo de uma vez a cada
 * carregamento de página é exatamente o que deixava a tela de Tags lenta.
 * Use `useTagsSearch`, `useTagCounts` ou `useTagStats` conforme a
 * necessidade de cada tela (lista paginada, contagem por CLP, ou
 * agregados pro dashboard).
 */
export function useHistorian() {
  const plcsQuery = useQuery({
    queryKey: PLCS_KEY,
    queryFn: async () => (await api.listPlcs()).map(fromApiPlc),
    refetchInterval: 10_000, // status de conexão muda com o tempo, mantém a bolinha viva
  });

  return {
    plcs: plcsQuery.data ?? [],
    isLoading: plcsQuery.isLoading,
    isError: plcsQuery.isError,
    error: plcsQuery.error,
  };
}

export interface TagsSearchParams {
  plcId?: string | undefined;
  area?: "registered" | "trigger" | undefined;
  loggingMode?: string | undefined;
  dataType?: string | undefined;
  q?: string | undefined;
  page: number;
  pageSize: number;
}

/**
 * Busca paginada e filtrada de tags — o banco já devolve só a página
 * pedida, então a tela continua rápida independente de ter 50 ou 50.000
 * tags cadastradas.
 */
export function useTagsSearch(params: TagsSearchParams) {
  const query = useQuery({
    queryKey: [...TAGS_SEARCH_KEY, params],
    queryFn: async () => {
      const res = await api.searchTags({
        plcId: params.plcId,
        area: params.area,
        loggingMode: params.loggingMode,
        dataType: params.dataType,
        q: params.q,
        limit: params.pageSize,
        offset: params.page * params.pageSize,
      });
      return { items: res.items.map(fromApiTag), total: res.total };
    },
    placeholderData: (prev) => prev, // evita "piscar" vazio ao trocar de página/filtro
    refetchInterval: 15_000, // mantém a bolinha de status de cada tag viva
  });

  return {
    tags: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}

/** Contagem de tags por CLP — usado pela tela de CLPs. */
export function useTagCounts() {
  const query = useQuery({ queryKey: TAG_COUNTS_KEY, queryFn: () => api.getTagCounts() });
  const byPlc = new Map((query.data ?? []).map((c) => [String(c.plc_id), c.count]));
  return { countByPlc: byPlc, isLoading: query.isLoading };
}

/** Agregados (total, por regra, por CLP) — usado pela tela inicial. */
export function useTagStats() {
  return useQuery({ queryKey: TAG_STATS_KEY, queryFn: () => api.getTagStats() });
}

/**
 * Escrita — cada método volta uma Promise (use com `await` e `try/catch`
 * nos formulários) e invalida o cache correspondente ao terminar, então
 * as telas que leem tags refletem a mudança no próximo refetch.
 */
export function useHistorianActions() {
  const qc = useQueryClient();
  const invalidatePlcs = () => qc.invalidateQueries({ queryKey: PLCS_KEY });
  const invalidateTags = () => {
    qc.invalidateQueries({ queryKey: TAGS_SEARCH_KEY });
    qc.invalidateQueries({ queryKey: TAG_COUNTS_KEY });
    qc.invalidateQueries({ queryKey: TAG_STATS_KEY });
  };

  const savePlcMut = useMutation({
    mutationFn: async (plc: Omit<Plc, "id"> & { id?: string }) => {
      const payload = toApiPlc(plc);
      return plc.id ? api.updatePlc(Number(plc.id), payload) : api.createPlc(payload);
    },
    onSuccess: invalidatePlcs,
  });

  const deletePlcMut = useMutation({
    mutationFn: (id: string) => api.deletePlc(Number(id)),
    onSuccess: () => {
      invalidatePlcs();
      invalidateTags(); // exclusão em cascata das tags desse CLP no backend
    },
  });

  const togglePlcMut = useMutation({
    mutationFn: (plc: Plc) => api.updatePlc(Number(plc.id), { enabled: !plc.enabled }),
    onSuccess: invalidatePlcs,
  });

  const saveTagMut = useMutation({
    mutationFn: async (tag: Omit<Tag, "id"> & { id?: string }) => {
      const payload = toApiTag(tag);
      return tag.id ? api.updateTag(Number(tag.id), payload) : api.createTag(payload);
    },
    onSuccess: invalidateTags,
  });

  const deleteTagMut = useMutation({
    mutationFn: (id: string) => api.deleteTag(Number(id)),
    onSuccess: invalidateTags,
  });

  const toggleTagMut = useMutation({
    mutationFn: (tag: Tag) => api.updateTag(Number(tag.id), { enabled: !tag.enabled }),
    onSuccess: invalidateTags,
  });

  const restartCollectorMut = useMutation({
    mutationFn: () => api.restartCollector(),
    onSuccess: invalidatePlcs, // status dos CLPs deve voltar a atualizar em instantes
  });

  return {
    savePlc: (plc: Omit<Plc, "id"> & { id?: string }) => savePlcMut.mutateAsync(plc),
    deletePlc: (id: string) => deletePlcMut.mutateAsync(id),
    togglePlc: (plc: Plc) => togglePlcMut.mutateAsync(plc),
    saveTag: (tag: Omit<Tag, "id"> & { id?: string }) => saveTagMut.mutateAsync(tag),
    deleteTag: (id: string) => deleteTagMut.mutateAsync(id),
    toggleTag: (tag: Tag) => toggleTagMut.mutateAsync(tag),
    restartCollector: () => restartCollectorMut.mutateAsync(),
  };
}
