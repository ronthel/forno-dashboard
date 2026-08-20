from .rockwell import RockwellLogixDriver, RockwellPCCCDriver
from .siemens import SiemensS7Driver
from .schneider import SchneiderModbusDriver

# Chaves aqui têm que bater literalmente com DRIVER_CATALOG em
# backend/app/routers/plcs.py e com DRIVERS em
# frontend/src/lib/historian-types.ts — é o contrato entre os três.
DRIVER_REGISTRY = {
    "rockwell_logix": RockwellLogixDriver,
    "rockwell_pccc": RockwellPCCCDriver,
    "siemens_s7": SiemensS7Driver,
    "schneider_modbus": SchneiderModbusDriver,
    # Modbus TCP não tem nada específico de fabricante — "modbus_tcp" é um
    # alias pro MESMO driver do Schneider acima, só com um nome que não
    # amarra a marca. Existe pra CLPs/equipamentos não-Schneider que
    # também falam Modbus TCP padrão (WAGO, Delta, ABB, etc).
    "modbus_tcp": SchneiderModbusDriver,
    # "opcua": não implementado neste MVP — CLP cadastrado com esse driver
    # fica sem coleta (get_driver_class levanta erro claro, tratado em
    # main.py, em vez de derrubar a thread de polling).
}


def get_driver_class(driver_name: str):
    cls = DRIVER_REGISTRY.get(driver_name)
    if not cls:
        raise ValueError(f"Driver '{driver_name}' não registrado")
    return cls
