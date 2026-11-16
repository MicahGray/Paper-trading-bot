import pytest

from backend.engine.execution import PaperExecutionEngine
from backend.engine.risk import RiskEngine, RiskLimitExceeded


def state(**overrides):
    value = {
        "positions": {"BTCUSDT": 0.0},
        "daily_pnl": {"2026-01-01": 0.0},
        "equity": 10000.0,
        "peak_equity": 10000.0,
    }
    value.update(overrides)
    return value


def signal(**overrides):
    value = {
        "timestamp": 1767225600000,
        "symbol": "BTCUSDT",
        "side": "buy",
        "price": 100.0,
        "notional": 1000.0,
    }
    value.update(overrides)
    return value


def test_risk_sizes_order_and_execution_is_paper_only():
    sized = RiskEngine().check_and_size(signal(), state())
    fill = PaperExecutionEngine().execute(sized)

    assert sized["quantity"] == pytest.approx(10.0)
    assert fill["side"] == "buy"
    assert fill["price"] > 100.0
    assert fill["fee"] > 0
    assert PaperExecutionEngine.live is False


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"notional": 3000.0}, "max_order"),
        ({"timestamp": None}, "timestamp"),
        ({"side": "hold"}, "side"),
        ({"daily_pnl": {"2026-01-01": -250.0}}, "daily loss"),
        ({"equity": 9200.0}, "drawdown"),
    ],
)
def test_risk_fails_closed(changes, message):
    order = signal(**{key: value for key, value in changes.items() if key in signal()})
    account = state(**{key: value for key, value in changes.items() if key in state()})
    with pytest.raises(RiskLimitExceeded, match=message):
        RiskEngine().check_and_size(order, account)


def test_execution_rejects_invalid_values():
    with pytest.raises(ValueError, match="positive"):
        PaperExecutionEngine().execute(signal(price=0))
