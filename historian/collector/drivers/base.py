"""
Interface base que todo driver de protocolo deve implementar.
Isso permite que o motor de coleta trate Rockwell, Siemens e Schneider
de forma uniforme, sem saber os detalhes de cada protocolo.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List


class BaseDriver(ABC):
    def __init__(self, plc_config: dict):
        self.plc_config = plc_config
        self.name = plc_config["name"]
        self.ip = plc_config["ip_address"]

    @abstractmethod
    def connect(self) -> bool:
        """Abre a conexão com o CLP. Retorna True se conectou."""
        raise NotImplementedError

    @abstractmethod
    def disconnect(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def read_tags(self, tags: List[dict]) -> Dict[int, Any]:
        """
        Lê uma lista de tags (dicts vindos da API, com id/address/data_type)
        em lote (uma única requisição sempre que o protocolo permitir).
        Retorna { tag_id: valor }. Em caso de falha de leitura de uma tag
        específica, ela simplesmente não aparece no dict de retorno.
        """
        raise NotImplementedError

    @property
    @abstractmethod
    def is_connected(self) -> bool:
        raise NotImplementedError
