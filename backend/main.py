import json
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import DATABASE_PATH, Base, SessionLocal, init_db
from models import Alert, BrowserEvent, CusumEvent, DecisionLog, Diagnostic, ProfitSweepAccount, Sentiment, SignatureStatistic, Trade, TradeReview, TradeSignature
from research import FEATURES

app = FastAPI()
MINIMUM_EDGE_RATIO = 2.0

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()
    with SessionLocal() as db:
        if db.get(Sentiment, "BTCUSDT") is None:
            db.add(Sentiment(symbol="BTCUSDT", score=0.12, quality=0.74, dispersion=0.18, effective_sources=3.6, size_multiplier=1.0, status="APPROVED"))
            db.commit()


def get_db():
    with SessionLocal() as db:
        yield db


def serialize(row):
    data = {column.name: getattr(row, column.name) for column in row.__table__.columns}
    for key, value in data.items():
        if hasattr(value, "isoformat"):
            data[key] = value.isoformat()
    return data


def timestamp(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value


class TradeRecord(BaseModel):
    event_id: str | None = Field(default=None, max_length=64)
    timestamp: datetime | None = None
    side: str | None = Field(default=None, max_length=10)
    lifecycle: str | None = Field(default=None, max_length=20)
    quantity: float = 0
    market_price: float = 0
    fill_price: float = 0
    fee: float = 0
    slippage: float = 0
    slippage_bps: float = 0
    realized_pnl: float = 0
    strategy: str | None = Field(default=None, max_length=50)
    regime: str | None = Field(default=None, max_length=30)
    sentiment_score: float = 0
    sentiment_quality: float = 0
    meta_probability: float = 0
    final_multiplier: float = 0
    signal: str | None = Field(default=None, max_length=20)
    expected_edge: float = 0
    expected_move_pct: float = 0
    expected_move_usd: float = 0
    expected_cost: float = 0
    expected_net_edge: float = 0


class CusumRecord(BaseModel):
    event_id: str = Field(min_length=1, max_length=64)
    timestamp: datetime | None = None
    direction: int
    market_price: float
    strength: float
    threshold: float


class CusumOutcomeRecord(BaseModel):
    evaluated_at: datetime | None = None
    exit_price: float = Field(gt=0)
    horizon_seconds: int = Field(default=1800, ge=1, le=86400)
    expected_return: float | None = None


class AlertRecord(BaseModel):
    timestamp: datetime | None = None
    severity: str = Field(max_length=20)
    title: str = Field(max_length=100)
    message: str = Field(max_length=500)


class DiagnosticRecord(BaseModel):
    timestamp: datetime | None = None
    level: str = Field(default="INFO", max_length=20)
    component: str = Field(default="browser", max_length=50)
    message: str = Field(max_length=500)
    details: dict = Field(default_factory=dict)


class DecisionRecord(BaseModel):
    event_id: str | None = Field(default=None, max_length=64)
    timestamp: datetime | None = None
    signal: str = Field(default="UNKNOWN", max_length=20)
    regime: str = Field(default="UNKNOWN", max_length=30)
    sentiment_score: float = 0
    sentiment_quality: float = 0
    decision: str = Field(default="REJECTED", max_length=20)
    reason: str = Field(default="", max_length=500)
    expected_edge: float = 0
    expected_move_pct: float = 0
    expected_move_usd: float = 0
    expected_cost: float = 0
    expected_net_edge: float = 0


class ProfitSweepAccountRecord(BaseModel):
    baseline: float = Field(gt=0)
    sweep_threshold: float = Field(gt=0)
    sweep_amount: float = Field(ge=50, le=1000, multiple_of=50)
    savings: float = Field(ge=0)
    total_invested: float = Field(ge=0)
    sweep_count: int = Field(ge=0)


@app.get("/")
def health():
    return {"status": "ok"}


@app.get("/db/status")
def database_status():
    tables = list(Base.metadata.tables)
    return {
        "status": "connected",
        "engine": "sqlite",
        "database": str(DATABASE_PATH),
        "tables": sorted(tables),
    }


@app.get("/research/status")
def research_status():
    return {"status": "available", "features": FEATURES}


@app.get("/sentiment/BTCUSDT/current")
def sentiment(db: Session = Depends(get_db)):
    row = db.get(Sentiment, "BTCUSDT")
    return serialize(row) if row else {}


@app.get("/account/BTCUSDT/profit-sweep")
def profit_sweep_account(db: Session = Depends(get_db)):
    row = db.get(ProfitSweepAccount, "BTCUSDT")
    if row:
        return serialize(row)
    return {
        "symbol": "BTCUSDT",
        "baseline": 10000.0,
        "sweep_threshold": 100.0,
        "sweep_amount": 100.0,
        "savings": 0.0,
        "total_invested": 0.0,
        "sweep_count": 0,
    }


@app.post("/account/BTCUSDT/profit-sweep")
def save_profit_sweep_account(record: ProfitSweepAccountRecord, db: Session = Depends(get_db)):
    row = db.get(ProfitSweepAccount, "BTCUSDT")
    if row is None:
        row = ProfitSweepAccount(symbol="BTCUSDT", **record.model_dump())
        db.add(row)
    else:
        for key, value in record.model_dump().items():
            setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return serialize(row)


@app.get("/trades/BTCUSDT")
def trades(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.scalars(select(Trade).where(Trade.symbol == "BTCUSDT").order_by(Trade.id.desc()).limit(max(1, min(limit, 500)))).all()
    return [serialize(row) for row in rows]


@app.get("/trade-signatures/BTCUSDT")
def trade_signatures(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.scalars(select(TradeSignature).where(TradeSignature.symbol == "BTCUSDT").order_by(TradeSignature.id.desc()).limit(max(1, min(limit, 500)))).all()
    return [serialize(row) for row in rows]


@app.get("/trade-reviews/BTCUSDT")
def trade_reviews(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.scalars(select(TradeReview).join(Trade, Trade.id == TradeReview.trade_id).where(Trade.symbol == "BTCUSDT").order_by(TradeReview.id.desc()).limit(max(1, min(limit, 500)))).all()
    return [serialize(row) for row in rows]


@app.get("/decision-log/BTCUSDT")
def decision_log(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.scalars(select(DecisionLog).where(DecisionLog.symbol == "BTCUSDT").order_by(DecisionLog.id.desc()).limit(max(1, min(limit, 500)))).all()
    return [serialize(row) for row in rows]


@app.get("/events/cusum/BTCUSDT")
def cusum(limit: int = 30, db: Session = Depends(get_db)):
    rows = db.scalars(select(CusumEvent).where(CusumEvent.symbol == "BTCUSDT").order_by(CusumEvent.id.desc()).limit(max(1, min(limit, 500)))).all()
    return [serialize(row) for row in rows]


@app.get("/signature-statistics/BTCUSDT")
def signature_statistics(db: Session = Depends(get_db)):
    rows = db.scalars(select(SignatureStatistic).where(SignatureStatistic.symbol == "BTCUSDT").order_by(SignatureStatistic.id)).all()
    return [serialize(row) for row in rows]


@app.get("/alerts/BTCUSDT")
def alerts(limit: int = 20, db: Session = Depends(get_db)):
    rows = db.scalars(select(Alert).where(Alert.symbol == "BTCUSDT").order_by(Alert.id.desc()).limit(max(1, min(limit, 500)))).all()
    return [serialize(row) for row in rows]


@app.get("/diagnostics")
def diagnostics(limit: int = 20, db: Session = Depends(get_db)):
    rows = db.scalars(select(Diagnostic).order_by(Diagnostic.id.desc()).limit(max(1, min(limit, 500)))).all()
    return [serialize(row) for row in rows]


@app.post("/trades/BTCUSDT", status_code=201)
def record_trade(record: TradeRecord, db: Session = Depends(get_db)):
    edge_ratio = record.expected_edge / record.expected_cost if record.expected_cost > 0 else 0
    if record.expected_cost > 0 and (record.expected_net_edge <= 0 or edge_ratio < MINIMUM_EDGE_RATIO):
        raise HTTPException(status_code=422, detail=f"trade rejected: edge ratio {edge_ratio:.2f}x is below the {MINIMUM_EDGE_RATIO:.2f}x minimum")
    row = Trade(symbol="BTCUSDT", timestamp=timestamp(record.timestamp), **record.model_dump(exclude={"timestamp", "signal"}))
    db.add(row)
    db.commit()
    db.refresh(row)
    signature = TradeSignature(
        trade_id=row.id,
        symbol="BTCUSDT",
        event_id=row.event_id,
        signal=record.signal or record.side or "UNKNOWN",
        regime=row.regime or "UNKNOWN",
        sentiment_score=row.sentiment_score,
        sentiment_quality=row.sentiment_quality,
        meta_probability=row.meta_probability,
        decision_multiplier=row.final_multiplier,
        expected_edge=row.expected_edge,
        expected_move_pct=row.expected_move_pct,
        expected_move_usd=row.expected_move_usd,
        expected_cost=row.expected_cost,
        expected_net_edge=row.expected_net_edge,
    )
    db.add(signature)
    if row.lifecycle in {"reduce", "close", "reverse"} and row.strategy != "PROFIT SWEEP":
        net_pnl = row.realized_pnl - row.fee
        if net_pnl > 0:
            classification, reason = "WIN", "Net P&L positive"
        elif row.expected_net_edge > 0 and (row.regime or "").upper() not in {"EXTREME", "VOLATILE"}:
            classification, reason = "GOOD LOSS", "Valid signal and positive expected net edge; market moved against trade"
        elif row.expected_cost >= row.expected_edge:
            classification, reason = "BAD LOSS", "Expected cost was greater than or equal to expected edge"
        else:
            classification, reason = "UNKNOWN", "Insufficient deterministic context for classification"
        db.add(TradeReview(
            trade_id=row.id,
            outcome="LOSS" if net_pnl < 0 else "WIN" if net_pnl > 0 else "FLAT",
            classification=classification,
            reason=reason,
            net_pnl=net_pnl,
        ))
    db.commit()
    return serialize(row)


@app.post("/decision-log/BTCUSDT", status_code=201)
def record_decision(record: DecisionRecord, db: Session = Depends(get_db)):
    row = DecisionLog(symbol="BTCUSDT", timestamp=timestamp(record.timestamp), **record.model_dump(exclude={"timestamp"}))
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize(row)


@app.post("/events/cusum/BTCUSDT", status_code=201)
def record_cusum_event(record: CusumRecord, db: Session = Depends(get_db)):
    existing = db.scalar(select(BrowserEvent).where(BrowserEvent.event_id == record.event_id))
    if existing:
        return {"status": "duplicate", "event_id": record.event_id}
    occurred_at = timestamp(record.timestamp)
    event = BrowserEvent(event_id=record.event_id, event_type="CUSUM", timestamp=occurred_at, payload=json.dumps(record.model_dump(mode="json")))
    row = CusumEvent(symbol="BTCUSDT", event_id=record.event_id, event_timestamp=occurred_at, direction=record.direction, market_price=record.market_price, strength=record.strength, threshold=record.threshold)
    db.add_all([event, row])
    db.commit()
    db.refresh(row)
    return serialize(row)


@app.post("/events/cusum/BTCUSDT/{event_id}/outcome")
def record_cusum_outcome(event_id: str, record: CusumOutcomeRecord, db: Session = Depends(get_db)):
    row = db.scalar(select(CusumEvent).where(CusumEvent.symbol == "BTCUSDT", CusumEvent.event_id == event_id))
    if row is None:
        return {"status": "not_found", "event_id": event_id}
    if row.outcome_status != "PENDING":
        return serialize(row)

    forward_return = row.direction * (record.exit_price / row.market_price - 1)
    row.forward_return = forward_return
    row.expected_return = record.expected_return
    row.actual_return = forward_return
    row.signal_success = forward_return > 0
    row.outcome_status = "WINNER" if forward_return > 0 else "LOSER" if forward_return < 0 else "FLAT"
    linked_trades = db.scalars(select(Trade).where(Trade.event_id == event_id)).all()
    row.net_pnl = sum(trade.realized_pnl - trade.fee for trade in linked_trades)
    row.trade_outcome = (
        "NO_TRADE"
        if not linked_trades
        else "WINNER"
        if row.net_pnl > 0
        else "LOSER"
        if row.net_pnl < 0
        else "FLAT"
    )
    row.trade_success = bool(linked_trades) and row.net_pnl > 0
    row.outcome_timestamp = timestamp(record.evaluated_at)
    row.outcome_horizon_seconds = record.horizon_seconds
    db.commit()
    db.refresh(row)
    strength_bucket = "1.0-1.2" if row.strength < 1.2 else "1.2-1.5" if row.strength < 1.5 else "1.5+"
    bucket_events = db.scalars(select(CusumEvent).where(CusumEvent.symbol == "BTCUSDT", CusumEvent.outcome_status != "PENDING", CusumEvent.strength >= (1.0 if strength_bucket == "1.0-1.2" else 1.2 if strength_bucket == "1.2-1.5" else 1.5), CusumEvent.strength < (1.2 if strength_bucket == "1.0-1.2" else 1.5 if strength_bucket == "1.2-1.5" else 999999))).all()
    stats = db.scalar(select(SignatureStatistic).where(SignatureStatistic.symbol == "BTCUSDT", SignatureStatistic.strength_bucket == strength_bucket))
    if stats is None:
        stats = SignatureStatistic(symbol="BTCUSDT", strength_bucket=strength_bucket)
        db.add(stats)
    stats.event_count = db.scalar(select(func.count()).select_from(CusumEvent).where(CusumEvent.symbol == "BTCUSDT", CusumEvent.strength >= (1.0 if strength_bucket == "1.0-1.2" else 1.2 if strength_bucket == "1.2-1.5" else 1.5), CusumEvent.strength < (1.2 if strength_bucket == "1.0-1.2" else 1.5 if strength_bucket == "1.2-1.5" else 999999))) or 0
    stats.evaluated_count = len(bucket_events)
    stats.win_count = sum(1 for event in bucket_events if event.signal_success)
    stats.win_rate = stats.win_count / stats.evaluated_count if stats.evaluated_count else 0
    stats.average_return = sum(event.actual_return or 0 for event in bucket_events) / stats.evaluated_count if stats.evaluated_count else 0
    stats.average_net_pnl = sum(event.net_pnl for event in bucket_events) / stats.evaluated_count if stats.evaluated_count else 0
    bucket_event_ids = [event.event_id for event in bucket_events if event.event_id]
    stats.good_loss_count = db.scalar(select(func.count()).select_from(TradeReview).join(Trade, Trade.id == TradeReview.trade_id).where(Trade.event_id.in_(bucket_event_ids), TradeReview.classification == "GOOD LOSS")) if bucket_event_ids else 0
    stats.good_loss_rate = stats.good_loss_count / stats.evaluated_count if stats.evaluated_count else 0
    db.commit()
    return serialize(row)


@app.post("/alerts/BTCUSDT", status_code=201)
def record_alert(record: AlertRecord, db: Session = Depends(get_db)):
    row = Alert(symbol="BTCUSDT", timestamp=timestamp(record.timestamp), **record.model_dump(exclude={"timestamp"}))
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize(row)


@app.post("/diagnostics", status_code=201)
def record_diagnostic(record: DiagnosticRecord, db: Session = Depends(get_db)):
    row = Diagnostic(timestamp=timestamp(record.timestamp), level=record.level.upper(), component=record.component, message=record.message, details=json.dumps(record.details))
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize(row)


@app.get("/results/BTCUSDT/summary")
def summary(db: Session = Depends(get_db)):
    trade_count = db.scalar(select(func.count()).select_from(Trade).where(Trade.symbol == "BTCUSDT")) or 0
    alert_count = db.scalar(select(func.count()).select_from(Alert).where(Alert.symbol == "BTCUSDT")) or 0
    event_count = db.scalar(select(func.count()).select_from(CusumEvent).where(CusumEvent.symbol == "BTCUSDT")) or 0
    diagnostic_count = db.scalar(select(func.count()).select_from(Diagnostic)) or 0
    evaluated_event_count = db.scalar(select(func.count()).select_from(CusumEvent).where(CusumEvent.symbol == "BTCUSDT", CusumEvent.outcome_status != "PENDING")) or 0
    winning_event_count = db.scalar(select(func.count()).select_from(CusumEvent).where(CusumEvent.symbol == "BTCUSDT", CusumEvent.outcome_status == "WINNER")) or 0
    event_net_pnl = db.scalar(select(func.coalesce(func.sum(CusumEvent.net_pnl), 0)).where(CusumEvent.symbol == "BTCUSDT")) or 0
    review_count = db.scalar(select(func.count()).select_from(TradeReview).join(Trade, Trade.id == TradeReview.trade_id).where(Trade.symbol == "BTCUSDT")) or 0
    good_loss_count = db.scalar(select(func.count()).select_from(TradeReview).join(Trade, Trade.id == TradeReview.trade_id).where(Trade.symbol == "BTCUSDT", TradeReview.classification == "GOOD LOSS")) or 0
    bad_loss_count = db.scalar(select(func.count()).select_from(TradeReview).join(Trade, Trade.id == TradeReview.trade_id).where(Trade.symbol == "BTCUSDT", TradeReview.classification == "BAD LOSS")) or 0
    decision_count = db.scalar(select(func.count()).select_from(DecisionLog).where(DecisionLog.symbol == "BTCUSDT")) or 0
    return {
        "total_trades": trade_count,
        "total_alerts": alert_count,
        "total_cusum_events": event_count,
        "total_diagnostics": diagnostic_count,
        "alert_to_trade_ratio": alert_count / trade_count if trade_count else 0,
        "evaluated_cusum_events": evaluated_event_count,
        "cusum_win_rate": winning_event_count / evaluated_event_count if evaluated_event_count else 0,
        "cusum_net_pnl": event_net_pnl,
        "trade_reviews": review_count,
        "good_loss_reviews": good_loss_count,
        "bad_loss_reviews": bad_loss_count,
        "decision_logs": decision_count,
    }
