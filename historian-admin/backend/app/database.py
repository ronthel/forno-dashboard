import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv()  # lê variáveis de um arquivo .env na pasta de execução, se existir

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://wtecc:wtecc_change_me@localhost:5432/wtecc_historian",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
