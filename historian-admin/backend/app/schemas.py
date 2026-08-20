from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, ConfigDict

Brand = Literal["rockwell", "siemens", "schneider", "modbus", "generic"]
DataType = Literal["bool", "int", "dint", "real", "string"]
LoggingMode = Literal["cyclic", "cos", "deadband", "conditional", "none", "compression"]
ConnectionStatus = Literal["online", "offline", "desconhecido"]


# ---------- PLC ----------
class PLCBase(BaseModel):
    name: str
    brand: Brand
    model: str
    driver: str
    ip_address: str
    port: Optional[int] = None
    slot: Optional[int] = None
    rack: Optional[int] = None
    extra_config: dict = {}
    poll_interval_ms: int = 1000
    enabled: bool = True


class PLCCreate(PLCBase):
    pass


class PLCUpdate(BaseModel):
    name: Optional[str] = None
    brand: Optional[Brand] = None
    model: Optional[str] = None
    driver: Optional[str] = None
    ip_address: Optional[str] = None
    port: Optional[int] = None
    slot: Optional[int] = None
    rack: Optional[int] = None
    extra_config: Optional[dict] = None
    poll_interval_ms: Optional[int] = None
    enabled: Optional[bool] = None


class PLCOut(PLCBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: ConnectionStatus = "desconhecido"
    last_seen_at: Optional[datetime] = None
    last_error: Optional[str] = None


# ---------- Tag ----------
class TagBase(BaseModel):
    plc_id: int
    name: str
    address: str
    data_type: DataType
    description: Optional[str] = None
    unit: Optional[str] = None

    logging_mode: LoggingMode = "cyclic"
    deadband_value: Optional[float] = None
    trigger_tag_id: Optional[int] = None
    trigger_condition: Optional[str] = None
    trigger_value: Optional[float] = None

    enabled: bool = True


class TagCreate(TagBase):
    pass


class TagUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    data_type: Optional[DataType] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    logging_mode: Optional[LoggingMode] = None
    deadband_value: Optional[float] = None
    trigger_tag_id: Optional[int] = None
    trigger_condition: Optional[str] = None
    trigger_value: Optional[float] = None
    enabled: Optional[bool] = None


class TagOut(TagBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trigger_tag_name: Optional[str] = None
    status: ConnectionStatus = "desconhecido"


class TagListOut(BaseModel):
    items: list[TagOut]
    total: int


class TagCountOut(BaseModel):
    plc_id: int
    count: int


class TagStatsOut(BaseModel):
    total: int
    enabled: int
    by_logging_mode: dict[str, int]
    by_plc: list[dict]
