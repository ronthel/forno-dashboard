"""
Autenticação simples pra 3 papéis fixos, com senha compartilhada por
papel (não é gerenciamento de usuário individual — foi decisão explícita
do projeto: poucas contas compartilhadas, não conta por pessoa).

- viewer: só leitura
- operator: leitura + habilitar/desabilitar + editar regra de tag existente
- admin: tudo, incluindo criar/excluir CLP e tag

As senhas ficam hasheadas na tabela `role_credentials` (uma linha por
papel) — nunca em texto puro no banco nem no .env. Um script separado
(`scripts/set_role_password.py`) define/troca a senha de cada papel.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Literal

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import get_db

router = APIRouter(prefix="/auth", tags=["Autenticação"])

JWT_SECRET = os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET:
    raise RuntimeError(
        "JWT_SECRET_KEY não configurado no .env — obrigatório para autenticação. "
        "Gere um valor aleatório longo e coloque no .env da API (ex: "
        "python -c \"import secrets; print(secrets.token_hex(32))\")."
    )
JWT_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 12

Role = Literal["viewer", "operator", "admin"]
ROLE_RANK = {"viewer": 0, "operator": 1, "admin": 2}  # pra checagem "pelo menos X"


class LoginRequest(BaseModel):
    role: Role
    password: str


class LoginResponse(BaseModel):
    token: str
    role: Role
    expires_at: datetime


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT password_hash FROM role_credentials WHERE role = :role"),
        {"role": payload.role},
    ).mappings().first()

    if not row or not bcrypt.checkpw(payload.password.encode(), row["password_hash"].encode()):
        # mensagem genérica de propósito — não dá pista se o papel existe
        # ou se foi só a senha que errou
        raise HTTPException(401, "Papel ou senha inválidos")

    expires_at = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    token = jwt.encode(
        {"role": payload.role, "exp": expires_at},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    return LoginResponse(token=token, role=payload.role, expires_at=expires_at)


class RoleStatus(BaseModel):
    role: Role
    has_password: bool
    updated_at: datetime | None


class ChangePasswordRequest(BaseModel):
    new_password: str


def get_current_role(authorization: str = Header(default=None)) -> Role:
    """Dependency que valida o token e devolve o papel — usar em qualquer
    rota que precise de QUALQUER usuário autenticado (viewer pra cima)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Não autenticado")
    token = authorization.removeprefix("Bearer ")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Sessão expirada, faça login de novo")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token inválido")
    return payload["role"]


def require_role(minimum: Role):
    """
    Dependency factory — exige pelo menos o papel `minimum` (viewer <
    operator < admin). Uso: `Depends(require_role("admin"))` numa rota.
    """
    def checker(role: Role = Depends(get_current_role)) -> Role:
        if ROLE_RANK[role] < ROLE_RANK[minimum]:
            raise HTTPException(403, f"Essa ação exige papel '{minimum}' ou superior")
        return role
    return checker


# --- Gestão de senhas pelo Administrador (tela /usuarios no frontend) ---
# Definidas aqui embaixo, depois de require_role, porque dependem dele.

@router.get("/roles", response_model=list[RoleStatus])
def list_roles(db: Session = Depends(get_db), _role: Role = Depends(require_role("admin"))):
    rows = db.execute(text("SELECT role, updated_at FROM role_credentials")).mappings().all()
    by_role = {r["role"]: r["updated_at"] for r in rows}
    all_roles: list[Role] = ["viewer", "operator", "admin"]
    return [
        RoleStatus(role=r, has_password=r in by_role, updated_at=by_role.get(r))
        for r in all_roles
    ]


@router.put("/roles/{role}/password")
def change_role_password(
    role: Role,
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    _role: Role = Depends(require_role("admin")),
):
    """Administrador pode trocar a senha de qualquer papel (inclusive a
    própria) sem precisar da senha antiga — é reset, não troca com
    confirmação da atual, de propósito (são contas compartilhadas, não
    contas pessoais com dono único)."""
    if len(payload.new_password) < 6:
        raise HTTPException(422, "Senha muito curta (mínimo 6 caracteres)")

    password_hash = bcrypt.hashpw(payload.new_password.encode(), bcrypt.gensalt()).decode()
    db.execute(
        text(
            """
            INSERT INTO role_credentials (role, password_hash, updated_at)
            VALUES (:role, :hash, now())
            ON CONFLICT (role) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()
            """
        ),
        {"role": role, "hash": password_hash},
    )
    db.commit()
    return {"ok": True}
