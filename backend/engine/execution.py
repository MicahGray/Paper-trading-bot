"""Deterministic paper fills.

This module deliberately has no broker client or live-order submission path.
"""

import math
from typing import Any


class PaperExecutionEngine:
    """Create a paper fill from a validated market-order intent."""

    live = False

    def __init__(self, fee_rate: float = 0.001, slippage_rate: float = 0.0005):
        for name, value in (("fee_rate", fee_rate), ("slippage_rate", slippage_rate)):
            if not math.isfinite(float(value)) or float(value) < 0:
                raise ValueError(f"{name} must be finite and non-negative")
        self.fee_rate = float(fee_rate)
        self.slippage_rate = float(slippage_rate)

    def execute(self, signal: dict[str, Any]) -> dict[str, Any]:
        side = str(signal.get("side", "")).lower()
        price = float(signal.get("price", 0))
        quantity = float(signal.get("quantity", 0))
        if side not in {"buy", "sell"}:
            raise ValueError("side must be 'buy' or 'sell'")
        if not math.isfinite(price) or price <= 0:
            raise ValueError("price must be finite and positive")
        if not math.isfinite(quantity) or quantity <= 0:
            raise ValueError("quantity must be finite and positive")

        direction = 1 if side == "buy" else -1
        fill_price = price * (1 + direction * self.slippage_rate)
        fee = fill_price * quantity * self.fee_rate
        return {
            "timestamp": signal.get("timestamp"),
            "symbol": signal.get("symbol", "BTCUSDT"),
            "side": side,
            "price": fill_price,
            "quantity": quantity,
            "fee": fee,
            "slippage": abs(fill_price - price) * quantity,
            "note": "paper-fill",
        }
