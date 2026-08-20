"""
Motor de regras de logging (o "filtro" do historiador).

Recebe o valor bruto lido de cada tag e decide se ele deve ser gravado em
tag_events, com base no logging_mode configurado:

  - cyclic:      sempre grava (a cada ciclo de poll do CLP)
  - cos:         grava só quando o valor mudou (change-of-state)
  - deadband:    grava só quando a variação absoluta desde a última gravação
                 for maior que deadband_value (tags analógicas ruidosas)
  - conditional: grava só quando outra tag (trigger_tag_id) atender a
                 trigger_condition (ex: '0->1', '1->0', 'any_change', '>', '<')
  - none:        nunca grava história própria — só é lida a cada ciclo pra
                 alimentar o cache de "último valor conhecido", usado por
                 outras tags no modo 'conditional' que apontam pra ela como
                 gatilho (ex: um pulso de disparo que não precisa virar
                 histórico, só serve pra acionar o registro de outra tag)
  - compression: algoritmo "swinging door" (o mesmo princípio usado pelo
                 OSIsoft PI para compressão de dados analógicos). Diferente
                 do deadband — que só compara com o ÚLTIMO PONTO GRAVADO —
                 a compressão olha a TENDÊNCIA: mantém uma "porta" (faixa de
                 inclinações) entre o último ponto arquivado e os pontos
                 recebidos depois dele, e só grava um novo ponto quando a
                 reta deixa de conseguir representar todos os pontos dentro
                 da tolerância (deadband_value, aqui reaproveitado como o
                 desvio máximo permitido da reta). Isso permite comprimir
                 rampas longas e lineares com muito menos pontos do que o
                 deadband simples, mantendo a forma real do sinal. Quando a
                 porta fecha por desvio real, grava o ponto anterior E o
                 atual (evita interpolação enganosa num gráfico). Aceita
                 também um intervalo máximo opcional (trigger_value, em
                 segundos, reaproveitado desse campo) — força um ponto
                 mesmo sem quebra de tolerância, pra sinais parados não
                 ficarem com buracos enormes no histórico.

O estado "último valor conhecido" é mantido em memória (dict) e espelhado na
tabela tag_last_value, para que o motor sobreviva a restarts sem re-gravar
tudo como se fosse a primeira leitura.
"""
import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

logger = logging.getLogger("wtecc.engine")


@dataclass
class TagConfig:
    id: int
    plc_id: int
    name: str
    address: str
    data_type: str
    logging_mode: str
    deadband_value: Optional[float]
    trigger_tag_id: Optional[int]
    trigger_condition: Optional[str]
    trigger_value: Optional[float]


class LoggingEngine:
    def __init__(self):
        # cache em memória do último valor conhecido de cada tag
        self._last_values: Dict[int, Any] = {}
        # estado do algoritmo de compressão (swinging door), por tag
        self._compression_state: Dict[int, dict] = {}

    def seed(self, tag_id: int, value: Any):
        """Carrega o último valor conhecido (ex: vindo do banco no startup)."""
        self._last_values[tag_id] = value

    def get_last_value(self, tag_id: int) -> Any:
        return self._last_values.get(tag_id)

    def should_log(self, tag: TagConfig, new_value: Any) -> bool:
        old_value = self._last_values.get(tag.id)

        decision = False

        if tag.logging_mode == "cyclic":
            decision = True

        elif tag.logging_mode == "cos":
            decision = old_value is None or new_value != old_value

        elif tag.logging_mode == "deadband":
            if old_value is None:
                decision = True
            else:
                try:
                    decision = abs(float(new_value) - float(old_value)) >= float(tag.deadband_value or 0)
                except (TypeError, ValueError):
                    decision = new_value != old_value

        elif tag.logging_mode == "conditional":
            # Nesse modo, quem decide é o valor da TRIGGER tag, não da
            # própria tag. Essa checagem é feita fora daqui pelo runner,
            # que já sabe o valor atual e anterior da trigger tag.
            decision = False  # placeholder; ver evaluate_trigger()

        elif tag.logging_mode == "none":
            # nunca grava — só mantém o cache atualizado (ver docstring)
            decision = False

        else:
            logger.warning("logging_mode desconhecido '%s' para tag %s - usando cyclic", tag.logging_mode, tag.name)
            decision = True

        # sempre atualiza o cache em memória com o valor mais recente lido,
        # independente de ter gravado ou não (é o "valor atual", não o
        # "último valor gravado")
        self._last_values[tag.id] = new_value
        return decision

    def compress(self, tag_id: int, time, value: Any, deviation: float, max_time_s: Optional[float] = None):
        """
        Algoritmo swinging-door (compressão por exceção, estilo OSIsoft PI).

        Mantém um ponto "arquivado" (o último realmente gravado) e um ponto
        "candidato" (o mais recente ainda represável pela reta em
        andamento, retido em buffer).

        Retorna uma LISTA de pontos a gravar — 0, 1 ou 2 tuplas (tempo,
        valor). Pode ser mais de um ponto por chamada:

          - Quando a "porta" fecha por desvio real (o ponto atual não cabe
            mais na reta em andamento), grava DOIS pontos: o candidato
            anterior (preserva o valor real de antes) E o ponto atual
            (reflete a mudança imediatamente) — sem isso, um gráfico
            interpolaria uma reta diagonal enganosa entre um valor antigo
            e o novo, em vez de mostrar o degrau real.
          - Quando max_time_s é informado e esse tempo se esgota sem
            nenhuma quebra real de tolerância, força a gravação do valor
            atual mesmo sem desvio (heartbeat) — evita que um sinal parado
            fique com um buraco enorme no histórico. Reinicia a porta a
            partir desse ponto.
          - Na maioria dos ciclos (sinal dentro da tolerância, sem
            timeout), não grava nada — devolve lista vazia.
        """
        state = self._compression_state.get(tag_id)
        v = float(value)

        if state is None:
            # primeiro ponto de todos: vira o ponto arquivado, sempre grava
            self._compression_state[tag_id] = {
                "archived_time": time, "archived_value": v,
                "candidate_time": None, "candidate_value": None,
                "max_slope": None, "min_slope": None,
            }
            return [(time, value)]

        if state["candidate_time"] is None:
            # segundo ponto: define os limites iniciais da porta, fica em buffer
            dt = (time - state["archived_time"]).total_seconds() or 1e-6
            state["max_slope"] = ((v + deviation) - state["archived_value"]) / dt
            state["min_slope"] = ((v - deviation) - state["archived_value"]) / dt
            state["candidate_time"] = time
            state["candidate_value"] = value
            return []

        dt = (time - state["archived_time"]).total_seconds() or 1e-6
        slope_upper = ((v + deviation) - state["archived_value"]) / dt
        slope_lower = ((v - deviation) - state["archived_value"]) / dt
        new_max = min(state["max_slope"], slope_upper)
        new_min = max(state["min_slope"], slope_lower)

        if new_max < new_min:
            # a porta fechou de verdade: o ponto atual não cabe mais na reta
            # em andamento — grava o candidato anterior E o ponto atual, e
            # reabre a porta do zero a partir daqui
            out_time = state["candidate_time"]
            out_value = state["candidate_value"]

            state["archived_time"] = time
            state["archived_value"] = v
            state["candidate_time"] = None
            state["candidate_value"] = None
            state["max_slope"] = None
            state["min_slope"] = None
            return [(out_time, out_value), (time, value)]

        # dentro da tolerância — atualiza a porta e o candidato normalmente
        state["max_slope"] = new_max
        state["min_slope"] = new_min
        state["candidate_time"] = time
        state["candidate_value"] = value

        if max_time_s is not None and dt >= max_time_s:
            # esgotou o intervalo máximo sem nenhuma quebra real — força um
            # "heartbeat": grava o valor atual e reabre a porta a partir dele
            state["archived_time"] = time
            state["archived_value"] = v
            state["candidate_time"] = None
            state["candidate_value"] = None
            state["max_slope"] = None
            state["min_slope"] = None
            return [(time, value)]

        return []

    def evaluate_trigger(self, condition: str, old_value: Any, new_value: Any, ref_value: Optional[float]) -> bool:
        """Avalia se a mudança da TRIGGER tag satisfaz a condição configurada."""
        if condition == "any_change":
            return old_value is None or new_value != old_value

        if condition == "0->1":
            return bool(old_value) is False and bool(new_value) is True

        if condition == "1->0":
            return bool(old_value) is True and bool(new_value) is False

        if condition == ">":
            try:
                return float(new_value) > float(ref_value)
            except (TypeError, ValueError):
                return False

        if condition == "<":
            try:
                return float(new_value) < float(ref_value)
            except (TypeError, ValueError):
                return False

        logger.warning("trigger_condition desconhecida: %s", condition)
        return False
