# Wtecc Historian — Frontend

Painel de gerenciamento do Wtecc Historian: cadastro de CLPs (Rockwell,
Siemens, Schneider) e tags, com as regras de filtragem que decidem o que é
gravado no histórico.

Construído com TanStack Start, React 19, TanStack Query, Tailwind CSS v4 e
shadcn/ui. Gerenciado com [Bun](https://bun.sh).

## Rodando localmente

```sh
bun install
bun run dev
```

Abra a porta indicada no terminal (normalmente `http://localhost:3000`).

## Conectando na API

Este frontend consome a API FastAPI do Wtecc Historian (repositório
separado: banco de dados + API + coletor). Por padrão ele aponta para
`http://localhost:8000` — para apontar para outro host, crie um arquivo
`.env` na raiz com:

```
VITE_API_URL=http://SEU_HOST:8000
```

Veja `.env.example`.

### O que já está integrado

- `src/lib/api-client.ts` — cliente HTTP para os endpoints `/plcs` e `/tags`.
- `src/lib/adapters.ts` — conversão entre os tipos da UI (`Plc`, `Tag`) e o
  formato que a API espera/retorna, incluindo o mapeamento das regras de
  filtragem da UI para o `logging_mode` do backend.
- `src/lib/historian-store.ts` — `useHistorian()` (leitura, via TanStack
  Query) e `useHistorianActions()` (criar/editar/excluir/habilitar, via
  mutations) substituem o antigo estado mockado em memória.

### Limitações conhecidas (gap UI ↔ backend)

A UI tem duas regras de filtragem que o motor de coleta ainda não
implementa. Ao salvar uma tag com uma dessas regras, a tela mostra um erro
em vez de gravar algo incorreto silenciosamente:

- **Intervalo fixo** (`on_interval`) — amostragem por tag em um intervalo
  próprio, independente do scan rate do CLP. O coletor hoje só lê no ritmo
  configurado por CLP.
- **Condição booleana** (`on_condition`) — expressões compostas tipo
  `A == 1 AND B > 2.5`. O motor de regras do coletor hoje só suporta uma
  tag de gatilho com uma condição simples (`0→1`, `1→0`, qualquer mudança).

Use **Sempre**, **Por variação (deadband)** ou **Disparo por outra tag**
por enquanto — essas três já gravam de verdade no TimescaleDB através da
API.

Outros dois campos existem na UI mas ainda não têm equivalente no backend
(ficam sem efeito real até o schema ser estendido): **Área/Planta** do CLP
e **Retenção (dias)** por tag.

## Build de produção

```sh
bun run build
bun run preview
```
