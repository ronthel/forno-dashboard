"""
teste_plc.py — Teste isolado de leitura do PLC (FASE 2.1 do runbook)

Uso:
    python teste_plc.py

Objetivo: validar a conexão CIP com o Logix Echo e a leitura das tags
ANTES de rodar o pipeline completo (plc_to_influx.py).
"""

from pycomm3 import LogixDriver

# TODO: preencher com o IP/slot real do PLC (Logix Echo)
# Ex.: "127.0.0.1/1" se o Echo estiver na própria VM
PLC_PATH = "192.168.15.108/0"

# TODO: ajustar para os nomes exatos das tags no Studio 5000
TAGS = ["CTP01", "CTQ", "CTV"]


def main():
    print(f"Conectando ao PLC em {PLC_PATH} ...")
    with LogixDriver(PLC_PATH) as plc:
        print("Conectado. Lendo tags:", TAGS)
        resultado = plc.read(*TAGS)
        print(resultado)


if __name__ == "__main__":
    main()
