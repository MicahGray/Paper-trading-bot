from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_PATH = Path(__file__).with_name("trading.db")
DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from models import Alert, BrowserEvent, CusumEvent, DecisionLog, Diagnostic, ProfitSweepAccount, Sentiment, SignatureStatistic, Trade, TradeReview, TradeSignature  # noqa: F401

    Base.metadata.create_all(bind=engine)
    profit_sweep_columns = {column["name"] for column in inspect(engine).get_columns("profit_sweep_accounts")}
    if "sweep_threshold" not in profit_sweep_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE profit_sweep_accounts ADD COLUMN sweep_threshold FLOAT DEFAULT 100.0"))
    if "sweep_amount" not in profit_sweep_columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE profit_sweep_accounts ADD COLUMN sweep_amount FLOAT DEFAULT 100.0"))
    # Existing project databases predate the event_id trade link. Keep startup
    # non-destructive while allowing new fills to retain their originating event.
    columns = {column["name"] for column in inspect(engine).get_columns("trades")}
    if "event_id" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE trades ADD COLUMN event_id VARCHAR(64)"))
    trade_columns = {column["name"] for column in inspect(engine).get_columns("trades")}
    trade_migrations = {
        "expected_edge": "ALTER TABLE trades ADD COLUMN expected_edge FLOAT DEFAULT 0.0",
        "expected_move_pct": "ALTER TABLE trades ADD COLUMN expected_move_pct FLOAT DEFAULT 0.0",
        "expected_move_usd": "ALTER TABLE trades ADD COLUMN expected_move_usd FLOAT DEFAULT 0.0",
        "expected_cost": "ALTER TABLE trades ADD COLUMN expected_cost FLOAT DEFAULT 0.0",
        "expected_net_edge": "ALTER TABLE trades ADD COLUMN expected_net_edge FLOAT DEFAULT 0.0",
    }
    missing_trade_columns = [statement for name, statement in trade_migrations.items() if name not in trade_columns]
    if missing_trade_columns:
        with engine.begin() as connection:
            for statement in missing_trade_columns:
                connection.execute(text(statement))
    table_migrations = {
        "trade_signatures": {
            "expected_move_pct": "ALTER TABLE trade_signatures ADD COLUMN expected_move_pct FLOAT DEFAULT 0.0",
            "expected_move_usd": "ALTER TABLE trade_signatures ADD COLUMN expected_move_usd FLOAT DEFAULT 0.0",
        },
        "decision_log": {
            "expected_move_pct": "ALTER TABLE decision_log ADD COLUMN expected_move_pct FLOAT DEFAULT 0.0",
            "expected_move_usd": "ALTER TABLE decision_log ADD COLUMN expected_move_usd FLOAT DEFAULT 0.0",
        },
    }
    for table_name, migrations in table_migrations.items():
        existing_columns = {column["name"] for column in inspect(engine).get_columns(table_name)}
        missing_columns = [statement for name, statement in migrations.items() if name not in existing_columns]
        if missing_columns:
            with engine.begin() as connection:
                for statement in missing_columns:
                    connection.execute(text(statement))
    event_columns = {column["name"] for column in inspect(engine).get_columns("cusum_events")}
    event_migrations = {
        "expected_return": "ALTER TABLE cusum_events ADD COLUMN expected_return FLOAT",
        "actual_return": "ALTER TABLE cusum_events ADD COLUMN actual_return FLOAT",
        "signal_success": "ALTER TABLE cusum_events ADD COLUMN signal_success BOOLEAN",
        "trade_success": "ALTER TABLE cusum_events ADD COLUMN trade_success BOOLEAN",
    }
    missing_event_columns = [statement for name, statement in event_migrations.items() if name not in event_columns]
    if missing_event_columns:
        with engine.begin() as connection:
            for statement in missing_event_columns:
                connection.execute(text(statement))
    event_columns = {column["name"] for column in inspect(engine).get_columns("cusum_events")}
    migrations = {
        "event_id": "ALTER TABLE cusum_events ADD COLUMN event_id VARCHAR(64)",
        "outcome_status": "ALTER TABLE cusum_events ADD COLUMN outcome_status VARCHAR(20) DEFAULT 'PENDING'",
        "forward_return": "ALTER TABLE cusum_events ADD COLUMN forward_return FLOAT",
        "trade_outcome": "ALTER TABLE cusum_events ADD COLUMN trade_outcome VARCHAR(20) DEFAULT 'PENDING'",
        "net_pnl": "ALTER TABLE cusum_events ADD COLUMN net_pnl FLOAT DEFAULT 0.0",
        "outcome_timestamp": "ALTER TABLE cusum_events ADD COLUMN outcome_timestamp DATETIME",
        "outcome_horizon_seconds": "ALTER TABLE cusum_events ADD COLUMN outcome_horizon_seconds INTEGER DEFAULT 1800",
    }
    missing = [statement for name, statement in migrations.items() if name not in event_columns]
    if missing:
        with engine.begin() as connection:
            for statement in missing:
                connection.execute(text(statement))
