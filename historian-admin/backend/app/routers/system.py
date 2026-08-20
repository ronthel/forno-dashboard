"""
Reinício manual do coletor — usado pela tela de CLPs quando o operador
precisa que o coletor reconecte de propósito (ex: tag nova criada no CLP,
ou o coletor parece travado/parou de gravar dados). Existe porque uma
tentativa anterior de reconectar AUTOMATICAMENTE dentro do driver
(rockwell.py, ao detectar uma tag quebrada) se mostrou instável em
produção — a reconexão agora é sempre uma ação explícita e deliberada do
usuário, nunca automática.

Precisa do socket do Docker montado neste container
(/var/run/docker.sock) para conseguir reiniciar OUTRO container a partir
daqui — dá a esta API o mesmo nível de acesso do host Docker, por isso a
rota é restrita ao papel "admin".
"""
from fastapi import APIRouter, Depends, HTTPException
import docker
from docker.errors import DockerException

from ..auth import require_role

router = APIRouter(prefix="/system", tags=["Sistema"])

# Docker Compose marca todo container que ele cria com esse label
# automaticamente — não precisamos saber o nome exato do container
# (ex: "forno-dashboard-historian-collector-1"), só o serviço.
COLLECTOR_SERVICE_LABEL = "com.docker.compose.service=historian-collector"


@router.post("/restart-collector")
def restart_collector(_role=Depends(require_role("admin"))):
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True, filters={"label": COLLECTOR_SERVICE_LABEL})
    except DockerException as exc:
        raise HTTPException(502, f"Não foi possível falar com o Docker: {exc}")

    if not containers:
        raise HTTPException(404, "Container do coletor não encontrado.")

    container = containers[0]
    try:
        container.restart(timeout=10)
    except DockerException as exc:
        raise HTTPException(502, f"Falha ao reiniciar o coletor: {exc}")

    return {"ok": True, "container": container.name}
