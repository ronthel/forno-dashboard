from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text
from typing import List
from datetime import datetime, timezone

from ..database import get_db
from .. import models, schemas
from ..auth import require_role

router = APIRouter(prefix="/plcs", tags=["PLCs"])

# Catálogo de drivers suportados -> usado pelo frontend para montar os selects
# em cascata (marca -> modelos -> driver correspondente).
# IDs de driver e nomes de modelo aqui têm que bater literalmente com
# DRIVERS em src/lib/historian-types.ts no frontend — é o contrato entre
# os dois lados.
DRIVER_CATALOG = {
    "rockwell": {
        "models": ["CompactLogix", "ControlLogix", "Micro820", "Micro850",
                   "MicroLogix 1100", "MicroLogix 1400", "SLC 500", "PLC-5"],
        "drivers": {
            "CompactLogix": "rockwell_logix",
            "ControlLogix": "rockwell_logix",
            "Micro820": "rockwell_logix",
            "Micro850": "rockwell_logix",
            "MicroLogix 1100": "rockwell_pccc",
            "MicroLogix 1400": "rockwell_pccc",
            "SLC 500": "rockwell_pccc",
            "PLC-5": "rockwell_pccc",
        },
        "default_port": 44818,
    },
    "siemens": {
        "models": ["S7-1200", "S7-1500", "S7-300", "S7-400"],
        "drivers": {
            "S7-1200": "siemens_s7",
            "S7-1500": "siemens_s7",
            "S7-300": "siemens_s7",
            "S7-400": "siemens_s7",
        },
        "default_port": 102,
    },
    "schneider": {
        "models": ["M221", "M241", "M251", "M580", "Quantum"],
        "drivers": {
            "M221": "schneider_modbus",
            "M241": "schneider_modbus",
            "M251": "schneider_modbus",
            "M580": "schneider_modbus",
            "Quantum": "schneider_modbus",
        },
        "default_port": 502,
    },
    "modbus": {
        # Mesmo driver do Schneider acima (Modbus TCP não tem nada
        # específico de fabricante) — essa entrada existe só pra não
        # obrigar o usuário a cadastrar um equipamento não-Schneider como
        # se fosse Schneider.
        "models": ["WAGO", "Delta", "ABB", "Beckhoff", "Weg", "Outro (Modbus TCP genérico)"],
        "drivers": {
            "WAGO": "modbus_tcp",
            "Delta": "modbus_tcp",
            "ABB": "modbus_tcp",
            "Beckhoff": "modbus_tcp",
            "Weg": "modbus_tcp",
            "Outro (Modbus TCP genérico)": "modbus_tcp",
        },
        "default_port": 502,
    },
    "generic": {
        "models": ["Servidor OPC UA"],
        "drivers": {
            "Servidor OPC UA": "opcua",
        },
        "default_port": 4840,
    },
}


@router.get("/catalog")
def get_catalog():
    """Retorna marcas, modelos e drivers suportados - usado para montar os selects do frontend."""
    return DRIVER_CATALOG


def _status_map(db: Session, plc_ids: List[int]) -> dict:
    """
    Busca o heartbeat mais recente de cada CLP (gravado pelo coletor em
    plc_status) e decide o status efetivo:
      - "desconhecido": nunca recebeu heartbeat (CLP novo, ou driver sem
        implementação no coletor, ex: opcua)
      - "offline": último heartbeat mais velho que 3x o poll_interval do
        CLP (thread travada/coletor caído conta como offline, não só
        "connected=false")
      - "online": heartbeat recente e conectado
    """
    if not plc_ids:
        return {}

    rows = db.execute(
        text(
            """
            SELECT s.plc_id, s.connected, s.updated_at, s.last_error, p.poll_interval_ms
            FROM plc_status s
            JOIN plcs p ON p.id = s.plc_id
            WHERE s.plc_id = ANY(:ids)
            """
        ),
        {"ids": plc_ids},
    ).mappings().all()

    now = datetime.now(timezone.utc)
    result = {}
    for r in rows:
        threshold_ms = max(r["poll_interval_ms"] * 3, 10000)
        age_ms = (now - r["updated_at"]).total_seconds() * 1000 if r["updated_at"] else None
        if age_ms is None or age_ms > threshold_ms:
            status = "offline"
        elif r["connected"]:
            status = "online"
        else:
            status = "offline"
        result[r["plc_id"]] = {
            "status": status,
            "last_seen_at": r["updated_at"],
            "last_error": r["last_error"],
        }
    return result


def _attach_status(plcs: List[models.PLC], db: Session) -> List[models.PLC]:
    status_map = _status_map(db, [p.id for p in plcs])
    for p in plcs:
        info = status_map.get(p.id, {"status": "desconhecido", "last_seen_at": None, "last_error": None})
        p.status = info["status"]
        p.last_seen_at = info["last_seen_at"]
        p.last_error = info["last_error"]
    return plcs


@router.get("", response_model=List[schemas.PLCOut])
def list_plcs(db: Session = Depends(get_db), _role=Depends(require_role("viewer"))):
    plcs = db.query(models.PLC).order_by(models.PLC.name).all()
    return _attach_status(plcs, db)


@router.get("/{plc_id}", response_model=schemas.PLCOut)
def get_plc(plc_id: int, db: Session = Depends(get_db), _role=Depends(require_role("viewer"))):
    plc = db.get(models.PLC, plc_id)
    if not plc:
        raise HTTPException(404, "CLP não encontrado")
    return _attach_status([plc], db)[0]


@router.post("", response_model=schemas.PLCOut, status_code=201)
def create_plc(payload: schemas.PLCCreate, db: Session = Depends(get_db), _role=Depends(require_role("admin"))):
    plc = models.PLC(**payload.model_dump())
    db.add(plc)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Já existe um CLP com esse nome")
    db.refresh(plc)
    plc.status = "desconhecido"
    plc.last_seen_at = None
    plc.last_error = None
    return plc


@router.put("/{plc_id}", response_model=schemas.PLCOut)
def update_plc(plc_id: int, payload: schemas.PLCUpdate, db: Session = Depends(get_db), _role=Depends(require_role("admin"))):
    plc = db.get(models.PLC, plc_id)
    if not plc:
        raise HTTPException(404, "CLP não encontrado")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(plc, field, value)
    db.commit()
    db.refresh(plc)
    return _attach_status([plc], db)[0]


@router.delete("/{plc_id}", status_code=204)
def delete_plc(plc_id: int, db: Session = Depends(get_db), _role=Depends(require_role("admin"))):
    plc = db.get(models.PLC, plc_id)
    if not plc:
        raise HTTPException(404, "CLP não encontrado")
    db.delete(plc)
    db.commit()


# ============================================================
# Busca ao vivo de tags direto no controlador — só Rockwell (CIP é
# baseado em nome simbólico; o pycomm3 já sobe a lista completa de tags
# do controlador ao conectar). Siemens/Modbus não têm esse conceito no
# protocolo (endereço bruto de memória, sem nome nenhum do lado do CLP)
# — não dá pra "descobrir" tag nenhuma neles por aqui.
# ============================================================
_browse_cache: dict[int, tuple[datetime, list]] = {}
_BROWSE_CACHE_TTL_S = 300  # 5 minutos — evita subir a lista inteira do controlador a cada tecla digitada na busca


@router.get("/{plc_id}/browse-tags")
def browse_tags(plc_id: int, q: str = "", db: Session = Depends(get_db), _role=Depends(require_role("viewer"))):
    plc = db.get(models.PLC, plc_id)
    if not plc:
        raise HTTPException(404, "CLP não encontrado")

    if plc.driver != "rockwell_logix":
        raise HTTPException(
            400,
            f"Busca ao vivo não é possível pra esse tipo de CLP (driver '{plc.driver}'). "
            "O protocolo desse fabricante não expõe uma lista de tags nomeadas — "
            "só endereço bruto de memória.",
        )

    now = datetime.now(timezone.utc)
    cached = _browse_cache.get(plc_id)
    if cached and (now - cached[0]).total_seconds() < _BROWSE_CACHE_TTL_S:
        all_tags = cached[1]
    else:
        import pycomm3

        slot = plc.slot if plc.slot is not None else 0
        path = f"{plc.ip_address}/{slot}"
        try:
            with pycomm3.LogixDriver(path) as driver:
                all_tags = [
                    {
                        "name": name,
                        "data_type": str(info.get("data_type")),
                        "is_array": bool(info.get("dim", 0)),
                    }
                    for name, info in driver.tags.items()
                    # tags de sistema do controlador (prefixo "__") não são
                    # úteis pra historizar, escondidas da busca
                    if not name.startswith("__")
                ]
        except Exception as exc:
            raise HTTPException(502, f"Falha ao conectar no CLP pra buscar as tags: {exc}")
        _browse_cache[plc_id] = (now, all_tags)

    if q:
        q_lower = q.lower()
        filtered = [t for t in all_tags if q_lower in t["name"].lower()]
    else:
        filtered = all_tags

    return {"items": filtered[:100], "total_no_controlador": len(all_tags), "total_encontrado": len(filtered)}
