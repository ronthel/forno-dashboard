from sqlalchemy import (
    Column, Integer, String, Boolean, Numeric, ForeignKey, JSON, DateTime, func
)
from sqlalchemy.orm import relationship
from .database import Base


class PLC(Base):
    __tablename__ = "plcs"

    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    brand = Column(String, nullable=False)          # rockwell | siemens | schneider | generic
    model = Column(String, nullable=False)           # compactlogix | micrologix | s7-1500 ...
    driver = Column(String, nullable=False)          # identifica o driver no collector
    ip_address = Column(String, nullable=False)
    port = Column(Integer, nullable=True)
    slot = Column(Integer, nullable=True)
    rack = Column(Integer, nullable=True)
    extra_config = Column(JSON, default=dict)
    poll_interval_ms = Column(Integer, nullable=False, default=1000)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    tags = relationship("Tag", back_populates="plc", cascade="all, delete-orphan", foreign_keys="Tag.plc_id")


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True)
    plc_id = Column(Integer, ForeignKey("plcs.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    address = Column(String, nullable=False)
    data_type = Column(String, nullable=False)       # bool | int | dint | real | string
    description = Column(String, nullable=True)
    unit = Column(String, nullable=True)

    logging_mode = Column(String, nullable=False, default="cyclic")  # cyclic|cos|deadband|conditional
    deadband_value = Column(Numeric, nullable=True)
    trigger_tag_id = Column(Integer, ForeignKey("tags.id", ondelete="SET NULL"), nullable=True)
    trigger_condition = Column(String, nullable=True)   # '0->1' | '1->0' | 'any_change' | '>' | '<'
    trigger_value = Column(Numeric, nullable=True)

    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    plc = relationship("PLC", back_populates="tags", foreign_keys=[plc_id])
    trigger_tag = relationship("Tag", remote_side=[id])
