"""
teste_plc.py — Teste isolado de leitura do PLC + descoberta de tags
(FASE 2.1 do runbook, e preparação para a tela de Variáveis dinâmica)

Uso:
    python teste_plc.py

O que faz:
  1. Conecta no PLC (Logix Echo) e confirma a leitura das TAGS de teste
     configuradas abaixo (igual antes).
  2. Lista TODAS as tags que o PLC expõe (o pycomm3 já faz isso sozinho ao
     conectar) e separa as "atômicas de valor único" (candidatas a virar
     uma variável monitorada no dashboard) das estruturas/arrays/UDTs
     (que não mapeiam direto para um único valor numérico).
  3. Salva a lista completa em tags_discovered.json, nesta mesma pasta,
     para inspecionar com calma sem depender do que coube no console.

Nada aqui grava no InfluxDB nem altera o PLC — é só leitura/diagnóstico.
"""

import json

from pycomm3 import LogixDriver

# TODO: preencher com o IP/slot real do PLC (Logix Echo)
# Ex.: "127.0.0.1/1" se o Echo estiver na própria VM
PLC_PATH = "192.168.15.108/0"

# TODO: ajustar para os nomes exatos das tags no Studio 5000
TAGS = ["CTP01", "CTQ", "CTV"]


def _is_struct(tag_info: dict) -> bool:
    """Uma tag é 'estrutura' (UDT, TIMER, etc.) se o data_type vier como um
    dict (descrição da estrutura) em vez de uma string simples (ex. 'DINT',
    'REAL', 'BOOL')."""
    return isinstance(tag_info.get("data_type"), dict)


def _data_type_label(tag_info: dict) -> str:
    data_type = tag_info.get("data_type")
    if isinstance(data_type, dict):
        return str(data_type.get("name", "estrutura"))
    return str(data_type)


def main():
    print(f"Conectando ao PLC em {PLC_PATH} ...")
    with LogixDriver(PLC_PATH) as plc:
        print("Conectado.\n")

        print("--- Teste 1: leitura das tags de exemplo ---")
        print("Lendo tags:", TAGS)
        resultado = plc.read(*TAGS)
        print(resultado)

        print("\n--- Teste 2: descoberta de todas as tags do controlador ---")
        all_tags = plc.tags or {}
        print(f"Total de tags encontradas: {len(all_tags)}\n")

        atomic_scalar = []
        others = []
        for name, info in all_tags.items():
            try:
                dim = info.get("dim", 0) or 0
                entry = {
                    "tag_name": name,
                    "data_type": _data_type_label(info),
                    "dim": dim,
                    "external_access": info.get("external_access"),
                }
                if not _is_struct(info) and dim == 0:
                    atomic_scalar.append(entry)
                else:
                    others.append(entry)
            except Exception as exc:
                print(f"  [aviso] nao consegui classificar a tag '{name}': {exc}")

        atomic_scalar.sort(key=lambda t: t["tag_name"])
        others.sort(key=lambda t: t["tag_name"])

        print(f"Tags atomicas de valor unico (candidatas a monitorar): {len(atomic_scalar)}")
        for t in atomic_scalar[:50]:
            print(f"  {t['tag_name']:<40} tipo={t['data_type']}")
        if len(atomic_scalar) > 50:
            print(f"  ... e mais {len(atomic_scalar) - 50} (veja tags_discovered.json)")

        print(f"\nOutras tags - estruturas/arrays/UDTs (nao mapeiam direto para 1 valor): {len(others)}")
        for t in others[:20]:
            print(f"  {t['tag_name']:<40} tipo={t['data_type']} dim={t['dim']}")
        if len(others) > 20:
            print(f"  ... e mais {len(others) - 20} (veja tags_discovered.json)")

        output = {
            "total": len(all_tags),
            "atomic_scalar": atomic_scalar,
            "others": others,
        }
        with open("tags_discovered.json", "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print("\nLista completa salva em tags_discovered.json")


if __name__ == "__main__":
    main()
