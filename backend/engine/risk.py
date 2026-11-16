"""Fail-closed risk checks for paper order intents."""

from datetime import datetime, timezone
import math
from typing import Any


class RiskLimitExceeded(Exception):
    """Raised when an order cannot safely be paper-executed."""


class RiskEngine:
    def __init__(
        self,
        max_position_usd: float = 2500.0,
        max_order_usd: float = 2500.0,
        daily_loss_limit_usd: float = 250.0,
        max_drawdown_usd: float = 800.0,
        kill_switch: bool = False,
        starting_equity: float = 10000.0,
    ):
        for name, value in (
            ("max_position_usd", max_position_usd),
            ("max_order_usd", max_order_usd),
            ("daily_loss_limit_usd", daily_loss_limit_usd),
            ("max_drawdown_usd", max_drawdown_usd),
        ):
            if not self._finite(value) or float(value) <= 0:
                raise ValueError(f"{name} must be finite and greater than zero")
        if not self._finite(starting_equity) or float(starting_equity) < 0:
            raise ValueError("starting_equity must be finite and non-negative")
        self.max_position_usd = float(max_position_usd)
        self.max_order_usd = float(max_order_usd)
        self.daily_loss_limit_usd = float(daily_loss_limit_usd)
        self.max_drawdown_usd = float(max_drawdown_usd)
        self.kill_switch = bool(kill_switch)
        self.starting_equity = float(starting_equity)

    @staticmethod
    def _finite(value: Any) -> bool:
        try:
            return math.isfinite(float(value))
        except (TypeError, ValueError):
            return False

    def check_and_size(self, signal: dict[str, Any], current_state: dict[str, Any]) -> dict[str, Any]:
        timestamp = signal.get("timestamp")
        if not self._finite(timestamp) or float(timestamp) <= 0:
            raise RiskLimitExceeded("timestamp must be finite and greater than zero")
        if self.kill_switch:
            raise RiskLimitExceeded("kill switch engaged")

        price = signal.get("price")
        if not self._finite(price) or float(price) <= 0:
            raise RiskLimitExceeded("price must be finite and positive")
        side = str(signal.get("side", "")).lower()
        if side not in {"buy", "sell"}:
            raise RiskLimitExceeded("side must be 'buy' or 'sell'")
        notional = signal.get("notional")
        if not self._finite(notional) or float(notional) <= 0:
            raise RiskLimitExceeded("notional must be finite and positive")
        notional = float(notional)
        if notional > self.max_order_usd:
            raise RiskLimitExceeded("order notional exceeds max_order_usd")

        symbol = signal.get("symbol", "BTCUSDT")
        positions = current_state.get("positions", {})
        position = positions.get(symbol, 0.0)
        if not self._finite(position):
            raise RiskLimitExceeded("position quantity is not finite")
        quantity = notional / float(price)
        projected = float(position) + (quantity if side == "buy" else -quantity)
        if abs(projected * float(price)) > self.max_position_usd:
            raise RiskLimitExceeded("projected position exceeds max_position_usd")

        day = datetime.fromtimestamp(float(timestamp) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        daily_pnl = current_state.get("daily_pnl", {}).get(day, 0.0)
        if not self._finite(daily_pnl):
            raise RiskLimitExceeded("daily P&L is not finite")
        if float(daily_pnl) <= -self.daily_loss_limit_usd:
            raise RiskLimitExceeded("daily loss limit reached")

        equity = current_state.get("equity", self.starting_equity)
        peak_equity = current_state.get("peak_equity", self.starting_equity)
        if not self._finite(equity) or not self._finite(peak_equity):
            raise RiskLimitExceeded("equity state is not finite")
        if float(peak_equity) - float(equity) >= self.max_drawdown_usd:
            raise RiskLimitExceeded("maximum drawdown reached")
        return {**signal, "symbol": symbol, "quantity": quantity}
