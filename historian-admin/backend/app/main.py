from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import engine, Base
from .routers import plcs, tags, storage, system
from . import auth

# Cria tabelas se ainda não existirem (o init.sql do Timescale já cuida disso
# no primeiro start do container; isto é apenas uma proteção extra em dev)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Wtecc Historian API",
    description="API de gerenciamento e coleta do Wtecc Historian",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrinja em produção
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(plcs.router)
app.include_router(tags.router)
app.include_router(storage.router)
app.include_router(system.router)


@app.get("/health")
def health():
    return {"status": "ok"}
