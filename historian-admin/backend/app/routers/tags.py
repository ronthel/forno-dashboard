from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, or_, text
from typing import List, Optional
from datetime import datetime, timezone

from ..database import get_db
from .. import models, schemas
from ..auth import require_role

router = APIRouter(prefix="/tags", tags=["Tags"])


def _validate_logging_rule(payload: dict, db: Session):
    mode = payload.get("logging_mode")
    if mode in ("deadband", "compression") and payload.get("deadband_value") is None:
        field_label = "desvio de compressão" if mode == "compression" else "deadband_value"
        raise HTTPException(422, f"logging_mode '{mode}' exige {field_label} (campo deadband_value)")
    if mode == "conditional":
        if not payload.get("trigger_tag_id") or not payload.get("trigger_condition"):
            raise HTTPException(
                422,
                "logging_mode 'conditional' exige trigger_tag_id e trigger_condition "
                "(ex: '0->1', '1->0', 'any_change', '>', '<')",
            )
        trigger_tag = db.get(models.Tag, payload["trigger_tag_id"])
        if not trigger_tag:
            raise HTTPException(422, "trigger_tag_id não corresponde a nenhuma tag existente")
        if payload["trigger_condition"] in (">", "<") and payload.get("trigger_value") is None:
            raise HTTPException(422, "trigger_condition '>' ou '<' exige trigger_value")


def _tag_status_map(db: Session, tag_ids: List[int]) -> dict:
    """
    Igual ao _status_map do router de PLCs, mas por tag: junta o heartbeat
    de leitura (tag_status) com o intervalo de scan do CLP dono, pra
    decidir "online" (leu com sucesso recentemente) vs "offline" (falhou
    ou o heartbeat está velho demais) vs "desconhecido" (nunca leu ainda).
    """
    if not tag_ids:
        return {}

    rows = db.execute(
        text(
            """
            SELECT s.tag_id, s.ok, s.updated_at, p.poll_interval_ms
            FROM tag_status s
            JOIN tags t ON t.id = s.tag_id
            JOIN plcs p ON p.id = t.plc_id
            WHERE s.tag_id = ANY(:ids)
            """
        ),
        {"ids": tag_ids},
    ).mappings().all()

    now = datetime.now(timezone.utc)
    result = {}
    for r in rows:
        threshold_ms = max(r["poll_interval_ms"] * 3, 10000)
        age_ms = (now - r["updated_at"]).total_seconds() * 1000 if r["updated_at"] else None
        if age_ms is None or age_ms > threshold_ms:
            status = "offline"
        elif r["ok"]:
            status = "online"
        else:
            status = "offline"
        result[r["tag_id"]] = status
    return result


def _attach_tag_status(items: List[models.Tag], db: Session) -> List[models.Tag]:
    status_map = _tag_status_map(db, [i.id for i in items])
    for i in items:
        i.status = status_map.get(i.id, "desconhecido")
    return items


def _attach_trigger_names(items: List[models.Tag], db: Session) -> List[models.Tag]:
    """
    Resolve o nome da tag de gatilho pra tags 'conditional', pra exibição
    na UI sem precisar carregar a lista inteira de tags no frontend
    (importante agora que /tags/search é paginado).
    """
    trigger_ids = {i.trigger_tag_id for i in items if i.trigger_tag_id is not None}
    if not trigger_ids:
        for i in items:
            i.trigger_tag_name = None
        return items

    name_map = dict(
        db.query(models.Tag.id, models.Tag.name).filter(models.Tag.id.in_(trigger_ids)).all()
    )
    for i in items:
        i.trigger_tag_name = name_map.get(i.trigger_tag_id)
    return items


@router.get("", response_model=List[schemas.TagOut])
def list_tags(
    plc_id: Optional[int] = Query(None, description="Filtra tags por CLP"),
    db: Session = Depends(get_db),
    _role=Depends(require_role("viewer")),
):
    """
    Lista completa, sem paginação — usada por scripts de automação (ex:
    bulk_create_array_tags.py) e por qualquer consumidor que precise do
    conjunto inteiro. Para a tela de gerenciamento com muitas tags, use
    GET /tags/search, que pagina e filtra no banco em vez de trazer tudo.
    """
    q = db.query(models.Tag)
    if plc_id is not None:
        q = q.filter(models.Tag.plc_id == plc_id)
    items = q.order_by(models.Tag.name).all()
    items = _attach_trigger_names(items, db)
    return _attach_tag_status(items, db)


@router.get("/counts", response_model=List[schemas.TagCountOut])
def tag_counts(db: Session = Depends(get_db), _role=Depends(require_role("viewer"))):
    """Contagem de tags por CLP — leve, usado pela tela de CLPs (evita
    baixar milhares de tags só pra mostrar um número)."""
    rows = (
        db.query(models.Tag.plc_id, func.count(models.Tag.id))
        .group_by(models.Tag.plc_id)
        .all()
    )
    return [{"plc_id": plc_id, "count": count} for plc_id, count in rows]


@router.get("/stats", response_model=schemas.TagStatsOut)
def tag_stats(db: Session = Depends(get_db), _role=Depends(require_role("viewer"))):
    """
    Agregados usados pela tela inicial (dashboard): total, habilitadas,
    distribuição por regra de gravação e por CLP — tudo calculado no banco,
    sem trazer nenhuma tag individual pro frontend.
    """
    total = db.query(func.count(models.Tag.id)).scalar() or 0
    enabled = db.query(func.count(models.Tag.id)).filter(models.Tag.enabled).scalar() or 0

    by_mode_rows = (
        db.query(models.Tag.logging_mode, func.count(models.Tag.id))
        .group_by(models.Tag.logging_mode)
        .all()
    )
    by_logging_mode = {mode: count for mode, count in by_mode_rows}

    by_plc_rows = (
        db.query(models.Tag.plc_id, models.PLC.name, func.count(models.Tag.id))
        .join(models.PLC, models.PLC.id == models.Tag.plc_id)
        .filter(models.Tag.enabled)
        .group_by(models.Tag.plc_id, models.PLC.name)
        .all()
    )
    by_plc = [{"plc_id": pid, "name": name, "enabled_count": count} for pid, name, count in by_plc_rows]

    return {"total": total, "enabled": enabled, "by_logging_mode": by_logging_mode, "by_plc": by_plc}


@router.get("/search", response_model=schemas.TagListOut)
def search_tags(
    plc_id: Optional[int] = Query(None),
    logging_mode: Optional[str] = Query(None, description="'none' = só gatilhos; qualquer outro valor = só esse modo"),
    area: Optional[str] = Query(None, description="'trigger' = logging_mode none; 'registered' = qualquer outro"),
    data_type: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Busca por nome ou endereço (case-insensitive, substring)"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _role=Depends(require_role("viewer")),
):
    """
    Busca paginada e filtrada no banco — usada pela tela de Tags do
    frontend. Com milhares de tags cadastradas, trazer a lista inteira pro
    navegador a cada carregamento fica lento; aqui o banco já devolve só a
    página e os filtros pedidos, com o total pra montar a paginação.
    """
    query = db.query(models.Tag)

    if plc_id is not None:
        query = query.filter(models.Tag.plc_id == plc_id)
    if data_type is not None:
        query = query.filter(models.Tag.data_type == data_type)
    if area == "trigger":
        query = query.filter(models.Tag.logging_mode == "none")
    elif area == "registered":
        query = query.filter(models.Tag.logging_mode != "none")
    if logging_mode is not None:
        query = query.filter(models.Tag.logging_mode == logging_mode)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(models.Tag.name.ilike(like), models.Tag.address.ilike(like)))

    total = query.count()
    items = query.order_by(models.Tag.name).offset(offset).limit(limit).all()
    items = _attach_trigger_names(items, db)
    items = _attach_tag_status(items, db)
    return {"items": items, "total": total}


@router.get("/{tag_id}", response_model=schemas.TagOut)
def get_tag(tag_id: int, db: Session = Depends(get_db), _role=Depends(require_role("viewer"))):
    tag = db.get(models.Tag, tag_id)
    if not tag:
        raise HTTPException(404, "Tag não encontrada")
    tag = _attach_trigger_names([tag], db)[0]
    return _attach_tag_status([tag], db)[0]


@router.post("", response_model=schemas.TagOut, status_code=201)
def create_tag(payload: schemas.TagCreate, db: Session = Depends(get_db), _role=Depends(require_role("admin"))):
    plc = db.get(models.PLC, payload.plc_id)
    if not plc:
        raise HTTPException(422, "plc_id não corresponde a nenhum CLP existente")

    data = payload.model_dump()
    _validate_logging_rule(data, db)

    tag = models.Tag(**data)
    db.add(tag)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Já existe uma tag com esse nome nesse CLP")
    db.refresh(tag)
    tag = _attach_trigger_names([tag], db)[0]
    tag.status = "desconhecido"  # tag recém-criada, ainda sem heartbeat
    return tag


@router.put("/{tag_id}", response_model=schemas.TagOut)
def update_tag(tag_id: int, payload: schemas.TagUpdate, db: Session = Depends(get_db), _role=Depends(require_role("operator"))):
    tag = db.get(models.Tag, tag_id)
    if not tag:
        raise HTTPException(404, "Tag não encontrada")

    merged = {
        "logging_mode": tag.logging_mode,
        "deadband_value": tag.deadband_value,
        "trigger_tag_id": tag.trigger_tag_id,
        "trigger_condition": tag.trigger_condition,
        "trigger_value": tag.trigger_value,
    }
    updates = payload.model_dump(exclude_unset=True)
    merged.update(updates)
    _validate_logging_rule(merged, db)

    for field, value in updates.items():
        setattr(tag, field, value)
    db.commit()
    db.refresh(tag)
    tag = _attach_trigger_names([tag], db)[0]
    return _attach_tag_status([tag], db)[0]


@router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: int, db: Session = Depends(get_db), _role=Depends(require_role("admin"))):
    tag = db.get(models.Tag, tag_id)
    if not tag:
        raise HTTPException(404, "Tag não encontrada")
    db.delete(tag)
    db.commit()
