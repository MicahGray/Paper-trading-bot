from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Sentiment(Base):
    __tablename__ = "sentiment"

    symbol: Mapped[str] = mapped_column(String(20), primary_key=True)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    quality: Mapped[float] = mapped_column(Float, default=0.0)
    dispersion: Mapped[float] = mapped_column(Float, default=0.0)
    effective_sources: Mapped[float] = mapped_column(Float, default=0.0)
    size_multiplier: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(30), default="UNKNOWN")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ProfitSweepAccount(Base):
    __tablename__ = "profit_sweep_accounts"

    symbol: Mapped[str] = mapped_column(String(20), primary_key=True)
    baseline: Mapped[float] = mapped_column(Float, default=10000.0)
    sweep_threshold: Mapped[float] = mapped_column(Float, default=100.0)
    sweep_amount: Mapped[float] = mapped_column(Float, default=100.0)
    savings: Mapped[float] = mapped_column(Float, default=0.0)
    total_invested: Mapped[float] = mapped_column(Float, default=0.0)
    sweep_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    event_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    side: Mapped[str | None] = mapped_column(String(10), nullable=True)
    lifecycle: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=0.0)
    market_price: Mapped[float] = mapped_column(Float, default=0.0)
    fill_price: Mapped[float] = mapped_column(Float, default=0.0)
    fee: Mapped[float] = mapped_column(Float, default=0.0)
    slippage: Mapped[float] = mapped_column(Float, default=0.0)
    slippage_bps: Mapped[float] = mapped_column(Float, default=0.0)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    strategy: Mapped[str | None] = mapped_column(String(50), nullable=True)
    regime: Mapped[str | None] = mapped_column(String(30), nullable=True)
    sentiment_score: Mapped[float] = mapped_column(Float, default=0.0)
    sentiment_quality: Mapped[float] = mapped_column(Float, default=0.0)
    meta_probability: Mapped[float] = mapped_column(Float, default=0.0)
    final_multiplier: Mapped[float] = mapped_column(Float, default=0.0)
    expected_edge: Mapped[float] = mapped_column(Float, default=0.0)
    expected_move_pct: Mapped[float] = mapped_column(Float, default=0.0)
    expected_move_usd: Mapped[float] = mapped_column(Float, default=0.0)
    expected_cost: Mapped[float] = mapped_column(Float, default=0.0)
    expected_net_edge: Mapped[float] = mapped_column(Float, default=0.0)


class TradeSignature(Base):
    __tablename__ = "trade_signatures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trade_id: Mapped[int] = mapped_column(Integer, index=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    event_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    signal: Mapped[str] = mapped_column(String(20), default="UNKNOWN")
    regime: Mapped[str] = mapped_column(String(30), default="UNKNOWN")
    sentiment_score: Mapped[float] = mapped_column(Float, default=0.0)
    sentiment_quality: Mapped[float] = mapped_column(Float, default=0.0)
    meta_probability: Mapped[float] = mapped_column(Float, default=0.0)
    decision_multiplier: Mapped[float] = mapped_column(Float, default=0.0)
    expected_edge: Mapped[float] = mapped_column(Float, default=0.0)
    expected_move_pct: Mapped[float] = mapped_column(Float, default=0.0)
    expected_move_usd: Mapped[float] = mapped_column(Float, default=0.0)
    expected_cost: Mapped[float] = mapped_column(Float, default=0.0)
    expected_net_edge: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TradeReview(Base):
    __tablename__ = "trade_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trade_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    outcome: Mapped[str] = mapped_column(String(20), default="UNKNOWN")
    classification: Mapped[str] = mapped_column(String(20), default="UNKNOWN")
    reason: Mapped[str] = mapped_column(String(500), default="")
    net_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DecisionLog(Base):
    __tablename__ = "decision_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    event_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    signal: Mapped[str] = mapped_column(String(20), default="UNKNOWN")
    regime: Mapped[str] = mapped_column(String(30), default="UNKNOWN")
    sentiment_score: Mapped[float] = mapped_column(Float, default=0.0)
    sentiment_quality: Mapped[float] = mapped_column(Float, default=0.0)
    decision: Mapped[str] = mapped_column(String(20), default="REJECTED")
    reason: Mapped[str] = mapped_column(String(500), default="")
    expected_edge: Mapped[float] = mapped_column(Float, default=0.0)
    expected_move_pct: Mapped[float] = mapped_column(Float, default=0.0)
    expected_move_usd: Mapped[float] = mapped_column(Float, default=0.0)
    expected_cost: Mapped[float] = mapped_column(Float, default=0.0)
    expected_net_edge: Mapped[float] = mapped_column(Float, default=0.0)


class CusumEvent(Base):
    __tablename__ = "cusum_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    event_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    event_timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    direction: Mapped[int] = mapped_column(Integer, default=0)
    market_price: Mapped[float] = mapped_column(Float, default=0.0)
    strength: Mapped[float] = mapped_column(Float, default=0.0)
    threshold: Mapped[float] = mapped_column(Float, default=0.0)
    outcome_status: Mapped[str] = mapped_column(String(20), default="PENDING")
    forward_return: Mapped[float | None] = mapped_column(Float, nullable=True)
    expected_return: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual_return: Mapped[float | None] = mapped_column(Float, nullable=True)
    signal_success: Mapped[bool | None] = mapped_column(nullable=True)
    trade_success: Mapped[bool | None] = mapped_column(nullable=True)
    trade_outcome: Mapped[str] = mapped_column(String(20), default="PENDING")
    net_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    outcome_timestamp: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    outcome_horizon_seconds: Mapped[int] = mapped_column(Integer, default=1800)


class SignatureStatistic(Base):
    __tablename__ = "signature_statistics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    strength_bucket: Mapped[str] = mapped_column(String(20))
    event_count: Mapped[int] = mapped_column(Integer, default=0)
    evaluated_count: Mapped[int] = mapped_column(Integer, default=0)
    win_count: Mapped[int] = mapped_column(Integer, default=0)
    win_rate: Mapped[float] = mapped_column(Float, default=0.0)
    average_return: Mapped[float] = mapped_column(Float, default=0.0)
    average_net_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    good_loss_count: Mapped[int] = mapped_column(Integer, default=0)
    good_loss_rate: Mapped[float] = mapped_column(Float, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    severity: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(100))
    message: Mapped[str] = mapped_column(String(500))


class BrowserEvent(Base):
    __tablename__ = "browser_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    payload: Mapped[str] = mapped_column(Text, default="{}")


class Diagnostic(Base):
    __tablename__ = "diagnostics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    level: Mapped[str] = mapped_column(String(20), default="INFO")
    component: Mapped[str] = mapped_column(String(50), default="browser")
    message: Mapped[str] = mapped_column(String(500))
    details: Mapped[str] = mapped_column(Text, default="{}")
