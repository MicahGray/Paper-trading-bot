import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Bell, Brain, Database, Gauge, Pause, Play, Power, Radio, RotateCcw, ShieldCheck } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const STARTING_EQUITY = 10000;
const START_PRICE = 29350;
const API_URL = "http://localhost:8000";
const BASELINE_OPTIONS = Array.from({ length: 100 }, (_, index) => (index + 1) * 1000);
const SWEEP_AMOUNT_OPTIONS = Array.from({ length: 20 }, (_, index) => (index + 1) * 50);
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const sma = (values, length) => values.length < length ? null : values.slice(-length).reduce((a, b) => a + b, 0) / length;
const std = (values) => {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
};

function createHistoryPoint({
  t = Date.now(),
  label,
  price = START_PRICE,
  equity = STARTING_EQUITY,
  regime = "RANGING",
  sentimentScore = 0,
  sentimentQuality = 0,
  sentimentDispersion = 0,
  tradePrice = null,
  tradeSide = null,
  pnl = 0,
  eventStrength = 0,
  eventDirection = 0,
} = {}) {
  return {
    t,
    label: label ?? new Date(t).toLocaleTimeString(),
    price: Number(price) || 0,
    equity: Number(equity) || 0,
    regime: regime || "UNKNOWN",
    sentimentScore: Number(sentimentScore) || 0,
    sentimentQuality: Number(sentimentQuality) || 0,
    sentimentDispersion: Number(sentimentDispersion) || 0,
    tradePrice: tradePrice == null ? null : Number(tradePrice),
    tradeSide: tradeSide || null,
    pnl: Number(pnl) || 0,
    eventStrength: Number(eventStrength) || 0,
    eventDirection: Number(eventDirection) || 0,
  };
}


function Metric({ label, value, tone = "text-slate-100" }) {
  return <div className="flex items-center justify-between gap-4 text-sm"><span className="text-slate-400">{label}</span><strong className={tone}>{value}</strong></div>;
}

function Pill({ children, color = "bg-slate-800 text-slate-200" }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${color}`}>{children}</span>;
}

export default function IntegratedTradingLab() {
  const [running, setRunning] = useState(false);
  const [killSwitch, setKillSwitch] = useState(false);
  const [killReason, setKillReason] = useState(null);
  const [price, setPrice] = useState(START_PRICE);
  const [cash, setCash] = useState(STARTING_EQUITY);
  const [profitBaseline, setProfitBaseline] = useState(STARTING_EQUITY);
  const [sweepThreshold, setSweepThreshold] = useState(100);
  const [sweepAmount, setSweepAmount] = useState(100);
  const [baselineDraft, setBaselineDraft] = useState(String(STARTING_EQUITY));
  const [sweepThresholdDraft, setSweepThresholdDraft] = useState("100");
  const [sweepAmountDraft, setSweepAmountDraft] = useState("100");
  const [accountSettingsMessage, setAccountSettingsMessage] = useState("");
  const [savings, setSavings] = useState(0);
  const [totalInvested, setTotalInvested] = useState(0);
  const [sweepCount, setSweepCount] = useState(0);
  const [profitStateLoaded, setProfitStateLoaded] = useState(false);
  const [position, setPosition] = useState(0);
  const [avgPrice, setAvgPrice] = useState(0);
  const [grossRealized, setGrossRealized] = useState(0);
  const [feesPaid, setFeesPaid] = useState(0);
  const [trades, setTrades] = useState([]);
  const [history, setHistory] = useState(() => Array.from({ length: 24 }, (_, index) => createHistoryPoint({
    t: Date.now() - (23 - index) * 1000,
    price: START_PRICE + Math.sin(index / 3) * 90 + index * 2,
    equity: STARTING_EQUITY + Math.sin(index / 4) * 18,
    label: new Date(Date.now() - (23 - index) * 1000).toLocaleTimeString(),
  })));
  const [cusumEvents, setCusumEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [visibleLayers, setVisibleLayers] = useState({ price: true, equity: true, sentiment: true });
  const [sqliteStatus, setSqliteStatus] = useState("CONNECTING");
  const [resultSummary, setResultSummary] = useState(null);
  const [signatureStats, setSignatureStats] = useState([]);
  const [regime, setRegime] = useState("RANGING");
  const [pendingRegime, setPendingRegime] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [sentiment, setSentiment] = useState({ score: 0.12, quality: 0.74, dispersion: 0.18, effectiveSources: 3.6, multiplier: 1, status: "APPROVED" });
  const [backendStatus, setBackendStatus] = useState("SIMULATION");
  const eventOutcomeHorizonMs = 30 * 60 * 1000;




  const pricesRef = useRef([START_PRICE]);
  const accountRef = useRef({ cash: STARTING_EQUITY, position: 0, avgPrice: 0, gross: 0, fees: 0 });
  const profitStateRef = useRef({ baseline: STARTING_EQUITY, sweepThreshold: 100, sweepAmount: 100, savings: 0, totalInvested: 0, sweepCount: 0 });
  const sweepArmedRef = useRef(true);
  const peakRef = useRef(STARTING_EQUITY);
  const cusumRef = useRef({ positive: 0, negative: 0 });
  const pendingOutcomesRef = useRef(new Map());
  const lastAlertRef = useRef(0);

  async function persist(path, payload) {
    try {
      const response = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      setSqliteStatus("CONNECTED");
      return response.json();
    } catch {
      setSqliteStatus("OFFLINE");
      return null;
    }
  }

  function recordDiagnostic(message, details = {}, level = "INFO") {
    void persist("/diagnostics", {
      timestamp: new Date().toISOString(), level, component: "trading-lab", message, details,
    });
  }

  const fast = 8;
  const slow = 21;
  const meanWindow = 30;
  const feeRate = 0.001;
  const baseSlippage = 0.0005;
  const maxPositionUsd = 2500;
  const dailyLossLimit = 250;
  const maxDrawdownLimit = 800;
  const confirmBars = 4;
  const minimumEdgeRatio = 2;

  const equity = cash + position * price;
  peakRef.current = Math.max(peakRef.current, equity);
  const drawdown = peakRef.current - equity;
  const dailyNetPnl = grossRealized - feesPaid;
  const netPnl = equity - profitBaseline;

  const maxLevel = Math.max(profitBaseline * 1.5, peakRef.current * 1.05);
  const highHigh = profitBaseline * 1.25;
  const high = profitBaseline * 1.12;
  const low = profitBaseline * 0.92;
  const lowLow = profitBaseline * 0.85;
  const envelopeZone = equity >= maxLevel ? "MAX" : equity >= highHigh ? "HIGH HIGH" : equity >= high ? "HIGH" : equity <= lowLow ? "LOW LOW" : equity <= low ? "LOW" : "NORMAL";
  const envelopeMultiplier = envelopeZone === "MAX" || envelopeZone === "LOW LOW" ? 0 : envelopeZone === "HIGH HIGH" ? 0.25 : envelopeZone === "HIGH" ? 0.75 : envelopeZone === "LOW" ? 0.5 : 1;

  const recent = pricesRef.current.slice(-30);
  const returns = recent.slice(1).map((v, i) => (v - recent[i]) / recent[i]);
  const volatility = std(returns);
  const fastMA = sma(pricesRef.current, fast);
  const slowMA = sma(pricesRef.current, slow);
  const mean = sma(pricesRef.current, meanWindow);
  const zScore = mean ? (price - mean) / Math.max(std(recent), 0.000001) : 0;
  const trendStrength = fastMA && slowMA ? Math.abs(fastMA - slowMA) / price : 0;

  const activeStrategy = regime === "TRENDING" ? "SMA MOMENTUM" : regime === "RANGING" ? "MEAN REVERSION" : "NO TRADE";
  const regimeMultiplier = regime === "TRENDING" ? 1 : regime === "RANGING" ? 0.75 : regime === "VOLATILE" ? 0.25 : 0;
  const metaProbability = clamp(0.5 + trendStrength * 16 + Math.abs(zScore) * 0.08 - volatility * 8);
  const decisionMultiplier = clamp(metaProbability * sentiment.multiplier * regimeMultiplier * envelopeMultiplier);
  const tradingBlocked = killSwitch || envelopeMultiplier === 0 || dailyNetPnl <= -dailyLossLimit || drawdown >= maxDrawdownLimit || regime === "EXTREME";

  const closedTrades = trades.filter((t) => t.realized);
  const winners = closedTrades.filter((t) => t.realizedPnl > 0);
  const grossProfit = winners.reduce((a, t) => a + t.realizedPnl, 0);
  const grossLoss = Math.abs(closedTrades.filter((t) => t.realizedPnl <= 0).reduce((a, t) => a + t.realizedPnl, 0));
  const winRate = closedTrades.length ? winners.length / closedTrades.length : 0;
  const profitFactor = grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  function addAlert(severity, title, message) {
    const now = Date.now();
    if (severity !== "CRITICAL" && now - lastAlertRef.current < 15000) return;
    lastAlertRef.current = now;
    const alert = { id: crypto.randomUUID(), timestamp: now, severity, title, message };
    setAlerts((items) => [alert, ...items].slice(0, 20));
    void persist("/alerts/BTCUSDT", {
      timestamp: new Date(now).toISOString(), severity, title, message,
    });
  }

  function tripKillSwitch(reason) {
    if (killSwitch) return;
    setKillSwitch(true);
    setKillReason(reason);
    setRunning(false);
    recordDiagnostic("Kill switch engaged", { reason }, "CRITICAL");
    addAlert("CRITICAL", "Kill switch engaged", reason);
  }

  function resetKillSwitch() {
    setKillSwitch(false);
    setKillReason(null);
    addAlert("INFO", "Kill switch reset", "Manual acknowledgement completed");
  }

  useEffect(() => {
    let cancelled = false;
    async function loadProfitSweepAccount() {
      try {
        const response = await fetch(`${API_URL}/account/BTCUSDT/profit-sweep`);
        if (!response.ok) throw new Error(`Account state: ${response.status}`);
        const data = await response.json();
        if (cancelled) return;
        const saved = {
          baseline: Number(data.baseline) || STARTING_EQUITY,
          sweepThreshold: Number(data.sweep_threshold) || 100,
          sweepAmount: Number(data.sweep_amount) || 100,
          savings: Number(data.savings) || 0,
          totalInvested: Number(data.total_invested) || 0,
          sweepCount: Number(data.sweep_count) || 0,
        };
        profitStateRef.current = saved;
        accountRef.current = { ...accountRef.current, cash: saved.baseline };
        peakRef.current = saved.baseline;
        setProfitBaseline(saved.baseline);
        setSweepThreshold(saved.sweepThreshold);
        setSweepAmount(saved.sweepAmount);
        setBaselineDraft(String(saved.baseline));
        setSweepThresholdDraft(String(saved.sweepThreshold));
        setSweepAmountDraft(String(saved.sweepAmount));
        setSavings(saved.savings);
        setTotalInvested(saved.totalInvested);
        setSweepCount(saved.sweepCount);
        setCash(saved.baseline);
        setHistory([createHistoryPoint({ equity: saved.baseline })]);
        setBackendStatus("CONNECTED");
      } catch {
        if (!cancelled) setSqliteStatus("OFFLINE");
      } finally {
        if (!cancelled) setProfitStateLoaded(true);
      }
    }
    loadProfitSweepAccount();
    return () => { cancelled = true; };
  }, []);

  async function saveAccountSettings() {
    const baseline = Number(baselineDraft);
    const threshold = Number(sweepThresholdDraft);
    const amount = Number(sweepAmountDraft);
    if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(threshold) || threshold <= 0
      || !SWEEP_AMOUNT_OPTIONS.includes(amount)) {
      setAccountSettingsMessage("Choose a valid baseline and savings transfer amount, and keep the sweep threshold above $0.");
      return;
    }

    const nextState = { ...profitStateRef.current, baseline, sweepThreshold: threshold, sweepAmount: amount };
    profitStateRef.current = nextState;
    setProfitBaseline(baseline);
    setSweepThreshold(threshold);
    setSweepAmount(amount);
    setAccountSettingsMessage("Saving account settings…");
    const saved = await persist("/account/BTCUSDT/profit-sweep", {
      baseline,
      sweep_threshold: threshold,
      sweep_amount: amount,
      savings: nextState.savings,
      total_invested: nextState.totalInvested,
      sweep_count: nextState.sweepCount,
    });
    setAccountSettingsMessage(saved ? "Account settings saved." : "Settings applied for this session, but could not be saved to the backend.");
  }

  function toggleRunning() {
    if (!profitStateLoaded) return;
    const next = !running;
    setRunning(next);
    recordDiagnostic(next ? "Simulation started" : "Simulation paused", { price, regime });
  }

  function recordDecision(eventId, signal, decision, reason, expectedMovePct, expectedMoveUsd, expectedEdge, expectedCost) {
    void persist("/decision-log/BTCUSDT", {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      signal,
      regime,
      sentiment_score: sentiment.score,
      sentiment_quality: sentiment.quality,
      decision,
      reason,
      expected_move_pct: expectedMovePct,
      expected_move_usd: expectedMoveUsd,
      expected_edge: expectedEdge,
      expected_cost: expectedCost,
      expected_net_edge: expectedEdge - expectedCost,
    });
  }

  function evaluateCusumOutcome(event, exitPrice, evaluatedAt) {
    void persist(`/events/cusum/BTCUSDT/${encodeURIComponent(event.id)}/outcome`, {
      exit_price: exitPrice,
      evaluated_at: new Date(evaluatedAt).toISOString(),
      horizon_seconds: eventOutcomeHorizonMs / 1000,
      expected_return: event.expectedReturn ?? null,
    }).then((outcome) => {
      if (!outcome || outcome.status === "not_found") return;
      setCusumEvents((items) => items.map((item) => item.id === event.id ? {
        ...item,
        outcomeStatus: outcome.outcome_status,
        forwardReturn: Number(outcome.forward_return || 0),
        tradeOutcome: outcome.trade_outcome,
        netPnl: Number(outcome.net_pnl || 0),
        expectedReturn: Number(outcome.expected_return || 0),
        actualReturn: Number(outcome.actual_return || 0),
        signalSuccess: outcome.signal_success,
        tradeSuccess: outcome.trade_success,
        outcomeTimestamp: outcome.outcome_timestamp,
      } : item));
    });
  }

  function adjustRegime(candidate) {
    if (candidate === regime) {
      setPendingRegime(null);
      setPendingCount(0);
      return regime;
    }
    const nextCount = pendingRegime === candidate ? pendingCount + 1 : 1;
    setPendingRegime(candidate);
    setPendingCount(nextCount);
    if (nextCount >= confirmBars) {
      const old = regime;
      setRegime(candidate);
      setPendingRegime(null);
      setPendingCount(0);
      addAlert("WARNING", "Regime transition", `${old} → ${candidate}`);
      return candidate;
    }
    return regime;
  }

  function executePaperFill(side, requestedQty, marketPrice, eventId = null) {
    if (tradingBlocked || requestedQty <= 0 || marketPrice <= 0) return;
    const a = accountRef.current;
    const qty = requestedQty * decisionMultiplier;
    if (qty <= 0) return;
    const orderNotional = qty * marketPrice;
    const slipRate = Math.min(0.02, baseSlippage * (1 + volatility * 50) * (1 + orderNotional / 100000));
    const fillPrice = marketPrice * (1 + (side === "BUY" ? 1 : -1) * slipRate);
    const signedQty = side === "BUY" ? qty : -qty;
    const projected = a.position + signedQty;
    if (Math.abs(projected * marketPrice) > maxPositionUsd + 0.01) return;

    const fee = fillPrice * qty * feeRate;
    const slippage = Math.abs(fillPrice - marketPrice) * qty;
    const expectedMovePct = clamp(Math.max(volatility * Math.sqrt(30), trendStrength), 0, 0.02);
    const expectedMoveUsd = expectedMovePct * marketPrice * qty;
    const confidenceEdgeFactor = clamp((metaProbability - 0.5) * 2);
    const expectedEdge = expectedMoveUsd * confidenceEdgeFactor;
    const expectedCost = fee + slippage;
    const expectedNetEdge = expectedEdge - expectedCost;
    const edgeRatio = expectedCost > 0 ? expectedEdge / expectedCost : 0;
    if (expectedNetEdge <= 0 || edgeRatio < minimumEdgeRatio) {
      recordDiagnostic("Paper fill rejected by economics gate", {
        expectedEdge,
        expectedCost,
        expectedNetEdge,
        edgeRatio,
        minimumEdgeRatio,
        eventId,
      }, "WARNING");
      return false;
    }
    const oldPosition = a.position;
    let lifecycle = oldPosition === 0 ? "open" : Math.sign(oldPosition) === Math.sign(signedQty) ? "increase" : "reduce";
    let realizedPnl = 0;

    if (oldPosition === 0 || Math.sign(oldPosition) === Math.sign(signedQty)) {
      const total = Math.abs(oldPosition) + Math.abs(signedQty);
      a.avgPrice = total ? (a.avgPrice * Math.abs(oldPosition) + fillPrice * Math.abs(signedQty)) / total : 0;
    } else {
      const closedQty = Math.min(Math.abs(oldPosition), Math.abs(signedQty));
      realizedPnl = oldPosition > 0 ? closedQty * (fillPrice - a.avgPrice) : closedQty * (a.avgPrice - fillPrice);
      lifecycle = Math.abs(signedQty) < Math.abs(oldPosition) ? "reduce" : Math.abs(signedQty) === Math.abs(oldPosition) ? "close" : "reverse";
      if (lifecycle === "close") a.avgPrice = 0;
      if (lifecycle === "reverse") a.avgPrice = fillPrice;
    }

    a.cash -= signedQty * fillPrice + fee;
    a.position = projected;
    a.gross += realizedPnl;
    a.fees += fee;
    setCash(a.cash); setPosition(a.position); setAvgPrice(a.avgPrice); setGrossRealized(a.gross); setFeesPaid(a.fees);
    setTrades((items) => [{
      id: crypto.randomUUID(), timestamp: Date.now(), symbol: "BTCUSDT", eventId, side, lifecycle, quantity: qty,
      marketPrice, fillPrice, fee, slippage, slippageBps: slipRate * 10000, realizedPnl,
      realized: ["reduce", "close", "reverse"].includes(lifecycle), strategy: activeStrategy, regime, expectedMovePct, expectedMoveUsd, expectedEdge, expectedCost, expectedNetEdge,
      sentimentScore: sentiment.score, sentimentQuality: sentiment.quality, metaProbability, decisionMultiplier
    }, ...items].slice(0, 50));
    void persist("/trades/BTCUSDT", {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      side, lifecycle, quantity: qty, market_price: marketPrice, fill_price: fillPrice,
      fee, slippage, slippage_bps: slipRate * 10000, realized_pnl: realizedPnl,
      signal: side, strategy: activeStrategy, regime, sentiment_score: sentiment.score,
      sentiment_quality: sentiment.quality, meta_probability: metaProbability,
      final_multiplier: decisionMultiplier,
      expected_move_pct: expectedMovePct, expected_move_usd: expectedMoveUsd, expected_edge: expectedEdge, expected_cost: expectedCost, expected_net_edge: expectedNetEdge,
    });
  }

  function sweepProfits(marketPrice, currentVolatility) {
    const account = accountRef.current;
    const savedState = profitStateRef.current;
    const baseline = savedState.baseline;
    if (account.cash < baseline + savedState.sweepThreshold) sweepArmedRef.current = true;
    let closeTrade = null;

    if (account.position !== 0) {
      const quantity = Math.abs(account.position);
      const side = account.position > 0 ? "SELL" : "BUY";
      const orderNotional = quantity * marketPrice;
      const slipRate = Math.min(0.02, baseSlippage * (1 + currentVolatility * 50) * (1 + orderNotional / 100000));
      const fillPrice = marketPrice * (1 + (side === "BUY" ? 1 : -1) * slipRate);
      const fee = fillPrice * quantity * feeRate;
      const slippage = Math.abs(fillPrice - marketPrice) * quantity;
      const realizedPnl = account.position > 0
        ? quantity * (fillPrice - account.avgPrice)
        : quantity * (account.avgPrice - fillPrice);
      const cashAfterClose = account.cash - (side === "BUY" ? quantity : -quantity) * fillPrice - fee;
      if (cashAfterClose < baseline + savedState.sweepThreshold) return;
      if (!sweepArmedRef.current) return;

      account.cash = cashAfterClose;
      account.position = 0;
      account.avgPrice = 0;
      account.gross += realizedPnl;
      account.fees += fee;
      closeTrade = {
        id: crypto.randomUUID(), timestamp: Date.now(), symbol: "BTCUSDT", eventId: null,
        side, lifecycle: "close", quantity, marketPrice, fillPrice, fee, slippage,
        slippageBps: slipRate * 10000, realizedPnl, realized: true, strategy: "PROFIT SWEEP",
        regime, expectedMovePct: 0, expectedMoveUsd: 0, expectedEdge: 0, expectedCost: fee + slippage,
        expectedNetEdge: -(fee + slippage), sentimentScore: sentiment.score,
        sentimentQuality: sentiment.quality, metaProbability, decisionMultiplier: 0,
      };
    } else if (account.cash < baseline + savedState.sweepThreshold) {
      return;
    } else if (!sweepArmedRef.current) {
      return;
    }

    const sweptAmount = account.cash - baseline;
    const selectedTransfer = Math.min(savedState.sweepAmount, sweptAmount);
    const remainingTransfer = sweptAmount - selectedTransfer;
    let nextSavings = savedState.savings + sweptAmount;
    let nextBaseline = baseline;
    let nextInvested = savedState.totalInvested;
    const nextSweepCount = savedState.sweepCount + 1;
    const reinvestment = Math.floor(nextSavings / 1000) * 1000;
    if (reinvestment > 0) {
      nextSavings -= reinvestment;
      nextBaseline += reinvestment;
      nextInvested += reinvestment;
    }

    account.cash = nextBaseline;
    sweepArmedRef.current = false;
    setCash(account.cash);
    setPosition(0);
    setAvgPrice(0);
    setGrossRealized(account.gross);
    setFeesPaid(account.fees);
    setProfitBaseline(nextBaseline);
    setSavings(nextSavings);
    setTotalInvested(nextInvested);
    setSweepCount(nextSweepCount);
    peakRef.current = Math.max(peakRef.current, nextBaseline);
    profitStateRef.current = {
      baseline: nextBaseline, sweepThreshold: savedState.sweepThreshold, sweepAmount: savedState.sweepAmount, savings: nextSavings, totalInvested: nextInvested, sweepCount: nextSweepCount,
    };
    setBaselineDraft(String(nextBaseline));

    if (closeTrade) {
      setTrades((items) => [closeTrade, ...items].slice(0, 50));
      void persist("/trades/BTCUSDT", {
        event_id: null,
        timestamp: new Date(closeTrade.timestamp).toISOString(),
        side: closeTrade.side, lifecycle: closeTrade.lifecycle, quantity: closeTrade.quantity,
        market_price: closeTrade.marketPrice, fill_price: closeTrade.fillPrice,
        fee: closeTrade.fee, slippage: closeTrade.slippage, slippage_bps: closeTrade.slippageBps,
        realized_pnl: closeTrade.realizedPnl, signal: closeTrade.side, strategy: "PROFIT SWEEP",
        regime, sentiment_score: sentiment.score, sentiment_quality: sentiment.quality,
        meta_probability: metaProbability, final_multiplier: 0,
        expected_move_pct: 0, expected_move_usd: 0, expected_edge: 0,
        expected_cost: closeTrade.expectedCost, expected_net_edge: closeTrade.expectedNetEdge,
      });
    }
    void persist("/account/BTCUSDT/profit-sweep", {
      baseline: nextBaseline, sweep_threshold: savedState.sweepThreshold, sweep_amount: savedState.sweepAmount, savings: nextSavings, total_invested: nextInvested, sweep_count: nextSweepCount,
    });
    addAlert("INFO", "Profit swept", `${fmt(selectedTransfer)} selected transfer + ${fmt(remainingTransfer)} remaining cash moved to savings${reinvestment ? ` · ${fmt(reinvestment)} reinvested` : ""}`);
  }

  useEffect(() => {
    let cancelled = false;
    async function refreshSentiment() {
      try {
        const response = await fetch(`${API_URL}/sentiment/BTCUSDT/current`);
        if (!response.ok) throw new Error("offline");
        const data = await response.json();
        if (!cancelled) {
          setBackendStatus("CONNECTED");
          setSentiment({
            score: Number(data.score) || 0,
            quality: clamp(Number(data.quality) || 0),
            dispersion: clamp(Number(data.dispersion) || 1),
            effectiveSources: Number(data.effective_sources) || 0,
            multiplier: clamp(Number(data.size_multiplier) || 0),
            status: data.status || "UNKNOWN"
          });
        }
      } catch {
        if (!cancelled) setBackendStatus("SIMULATION");
      }
    }
    refreshSentiment();
    const timer = setInterval(refreshSentiment, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;


    async function getJson(path) {
      const response = await fetch(`${API_URL}${path}`);
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return response.json();
    }


function normalizeTrade(row, review = null) {
      return {
        id: row.id,
        timestamp: row.timestamp,
        symbol: row.symbol,
        eventId: row.event_id,
        side: row.side,
        lifecycle: row.lifecycle,
        quantity: Number(row.quantity || 0),
        marketPrice: Number(row.market_price || 0),
        fillPrice: Number(row.fill_price || 0),
        fee: Number(row.fee || 0),
        slippage: Number(row.slippage || 0),
        slippageBps: Number(row.slippage_bps || 0),
        realizedPnl: Number(row.realized_pnl || 0),
        realized: ["reduce", "close", "reverse"].includes(row.lifecycle),
        strategy: row.strategy || "DATABASE RESULT",
        regime: row.regime || "UNKNOWN",
        sentimentScore: Number(row.sentiment_score || 0),
        sentimentQuality: Number(row.sentiment_quality || 0),
        metaProbability: Number(row.meta_probability || 0),
        decisionMultiplier: Number(row.final_multiplier || 0),
 expectedEdge: Number(row.expected_edge || 0),
 expectedMovePct: Number(row.expected_move_pct || 0),
 expectedMoveUsd: Number(row.expected_move_usd || 0),
 expectedCost: Number(row.expected_cost || 0),
 expectedNetEdge: Number(row.expected_net_edge || 0),
 classification: review?.classification || null,
 reviewReason: review?.reason || null,
};
    }


    function normalizeEvent(row) {
      return {
id: row.event_id || row.id,
        timestamp: row.event_timestamp,
        direction: Number(row.direction || 0),
        price: Number(row.market_price || 0),
        strength: Number(row.strength || 0),
        threshold: Number(row.threshold || 0),
outcomeStatus: row.outcome_status || "PENDING",
forwardReturn: Number(row.forward_return || 0),
tradeOutcome: row.trade_outcome || "PENDING",
netPnl: Number(row.net_pnl || 0),
expectedReturn: Number(row.expected_return || 0),
actualReturn: Number(row.actual_return || 0),
signalSuccess: row.signal_success,
tradeSuccess: row.trade_success,
outcomeTimestamp: row.outcome_timestamp,
};
    }


    async function refreshSqliteResults() {
      try {
const [storedTrades, storedEvents, storedAlerts, storedReviews, storedSignatureStats, summary] = await Promise.all([
          getJson("/trades/BTCUSDT?limit=50"),
          getJson("/events/cusum/BTCUSDT?limit=30"),
          getJson("/alerts/BTCUSDT?limit=20"),
getJson("/trade-reviews/BTCUSDT?limit=50"),
getJson("/signature-statistics/BTCUSDT"),
getJson("/results/BTCUSDT/summary"),
        ]);


        if (cancelled) return;


const reviewsByTrade = new Map(storedReviews.map((review) => [review.trade_id, review]));
setTrades(storedTrades.map((trade) => normalizeTrade(trade, reviewsByTrade.get(trade.id))));
        setCusumEvents(storedEvents.map(normalizeEvent));
setSignatureStats(storedSignatureStats);
        setAlerts(storedAlerts.map((row) => ({
          id: row.id,
          timestamp: row.timestamp,
          severity: row.severity,
          title: row.title,
          message: row.message,
        })));
         setResultSummary({
          totalTrades: Number(summary.total_trades || 0),
          totalAlerts: Number(summary.total_alerts || 0),
          totalCusumEvents: Number(summary.total_cusum_events || 0),
          totalDiagnostics: Number(summary.total_diagnostics || 0),
          alertToTradeRatio: Number(summary.alert_to_trade_ratio || 0),
evaluatedCusumEvents: Number(summary.evaluated_cusum_events || 0),
cusumWinRate: Number(summary.cusum_win_rate || 0),
cusumNetPnl: Number(summary.cusum_net_pnl || 0),
tradeReviews: Number(summary.trade_reviews || 0),
goodLossReviews: Number(summary.good_loss_reviews || 0),
badLossReviews: Number(summary.bad_loss_reviews || 0),
decisionLogs: Number(summary.decision_logs || 0),
databaseUpdatedAt: Date.now(),
        });
        setSqliteStatus("CONNECTED");
      } catch {
        if (!cancelled) setSqliteStatus("OFFLINE");
      }
    }


    refreshSqliteResults();
    const timer = setInterval(refreshSqliteResults, 5000);


    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);


  useEffect(() => {
    if (!running || tradingBlocked || !profitStateLoaded) return;
    const timer = setInterval(() => {
      const old = pricesRef.current.at(-1) ?? START_PRICE;
      const nextTimestamp = Date.now();
      const shock = Math.random() < 0.025 ? (Math.random() - 0.5) * 0.015 : 0;
      const next = Math.max(1, old * (1 + (Math.random() - 0.5) * 0.002 + shock));
      const returnValue = next / old - 1;
      pricesRef.current = [...pricesRef.current.slice(-299), next];
      setPrice(next);

      const localReturns = pricesRef.current.slice(-21).slice(1).map((v, i, arr) => v / pricesRef.current.slice(-21)[i] - 1);
      const localVol = std(localReturns);
      const localFast = sma(pricesRef.current, fast);
      const localSlow = sma(pricesRef.current, slow);
      const localTrend = localFast && localSlow ? Math.abs(localFast - localSlow) / next : 0;
      const trendEntry = 0.0025 * (1 + localVol * 40);
      const trendExit = 0.0014 * (1 + localVol * 40);
      let candidate = regime;
      if (localVol > 0.006) candidate = "EXTREME";
      else if (localVol > 0.003) candidate = "VOLATILE";
      else if (regime === "TRENDING") candidate = localTrend <= trendExit ? "RANGING" : "TRENDING";
      else candidate = localTrend >= trendEntry ? "TRENDING" : "RANGING";
      const effectiveRegime = adjustRegime(candidate);

      const adaptiveThreshold = Math.max(0.0012, localVol * 2.5);
      cusumRef.current.positive = Math.max(0, cusumRef.current.positive + returnValue);
      cusumRef.current.negative = Math.min(0, cusumRef.current.negative + returnValue);
      let event = null;
      if (cusumRef.current.positive >= adaptiveThreshold) {
        event = { id: crypto.randomUUID(), timestamp: nextTimestamp, direction: 1, price: next, strength: cusumRef.current.positive / adaptiveThreshold, threshold: adaptiveThreshold, outcomeStatus: "PENDING", forwardReturn: 0, tradeOutcome: "PENDING", netPnl: 0 };
        cusumRef.current.positive = 0;
      } else if (cusumRef.current.negative <= -adaptiveThreshold) {
        event = { id: crypto.randomUUID(), timestamp: nextTimestamp, direction: -1, price: next, strength: Math.abs(cusumRef.current.negative) / adaptiveThreshold, threshold: adaptiveThreshold, outcomeStatus: "PENDING", forwardReturn: 0, tradeOutcome: "PENDING", netPnl: 0 };
        cusumRef.current.negative = 0;
      }
      if (event) {
        pendingOutcomesRef.current.set(event.id, event);
        setCusumEvents((items) => [event, ...items].slice(0, 30));
        void persist("/events/cusum/BTCUSDT", {
          event_id: event.id,
          timestamp: new Date(event.timestamp).toISOString(),
          direction: event.direction,
          market_price: event.price,
          strength: event.strength,
          threshold: event.threshold,
        });
        addAlert(event.strength > 2 ? "WARNING" : "INFO", event.direction > 0 ? "Bullish CUSUM event" : "Bearish CUSUM event", `Strength ${event.strength.toFixed(2)}×`);
      }

      for (const [eventId, pendingEvent] of pendingOutcomesRef.current) {
        if (nextTimestamp - pendingEvent.timestamp >= eventOutcomeHorizonMs) {
          evaluateCusumOutcome(pendingEvent, next, nextTimestamp);
          pendingOutcomesRef.current.delete(eventId);
        }
      }

      const a = accountRef.current;
      const localMean = sma(pricesRef.current, meanWindow);
      const localStd = std(pricesRef.current.slice(-meanWindow));
      const localZ = localMean ? (next - localMean) / Math.max(localStd, 0.000001) : 0;
      const baseQty = Math.min(maxPositionUsd, Math.max(0, a.cash) * 0.25) / next;
      const expectedQty = baseQty * decisionMultiplier;
      const expectedMovePct = clamp(Math.max(localVol * Math.sqrt(30), localTrend), 0, 0.02);
      const expectedMoveUsd = expectedMovePct * next * expectedQty;
      const expectedEdge = expectedMoveUsd * clamp((metaProbability - 0.5) * 2);
      const expectedCost = next * expectedQty * (feeRate + baseSlippage);
      const expectedNetEdge = expectedEdge - expectedCost;
      let proposedSide = null;
      let decisionReason = "No strategy setup";

      if (event && effectiveRegime === "TRENDING" && localFast && localSlow) {
        if (event.direction > 0 && localFast > localSlow && a.position >= 0) {
          proposedSide = "BUY";
          decisionReason = "Bullish CUSUM aligned with trend";
        }
        if (event.direction < 0 && localFast < localSlow && a.position <= 0) {
          proposedSide = "SELL";
          decisionReason = "Bearish CUSUM aligned with trend";
        }
        if (!proposedSide) decisionReason = "CUSUM direction, trend, or position does not support entry";
      }
      if (event && effectiveRegime === "RANGING") {
        if (event.direction > 0 && localZ <= -1.5 && a.position >= 0) {
          proposedSide = "BUY";
          decisionReason = "Bullish CUSUM confirms mean-reversion buy setup";
        }
        if (event.direction < 0 && localZ >= 1.5 && a.position <= 0) {
          proposedSide = "SELL";
          decisionReason = "Bearish CUSUM confirms mean-reversion sell setup";
        }
        if (!proposedSide) decisionReason = "CUSUM direction, z-score, or position does not support entry";
      }
      if (event) {
          const edgeRatio = expectedCost > 0 ? expectedEdge / expectedCost : 0;
          const accepted = Boolean(proposedSide) && expectedNetEdge > 0 && edgeRatio >= minimumEdgeRatio;
          const reason = accepted ? decisionReason : proposedSide ? edgeRatio < minimumEdgeRatio ? `Edge ratio ${edgeRatio.toFixed(2)}x below ${minimumEdgeRatio.toFixed(2)}x minimum` : "Cost exceeds expected edge" : decisionReason;
        recordDecision(event.id, proposedSide || "NONE", accepted ? "ACCEPTED" : "REJECTED", reason, expectedMovePct, expectedMoveUsd, expectedEdge, expectedCost);
        if (accepted && proposedSide === "BUY") executePaperFill("BUY", baseQty, next, event.id);
        if (accepted && proposedSide === "SELL") executePaperFill("SELL", baseQty, next, event.id);
      }

      sweepProfits(next, localVol);
      const liveEquity = accountRef.current.cash + accountRef.current.position * next;
      peakRef.current = Math.max(peakRef.current, liveEquity);
      setHistory((items) => [...items.slice(-179), createHistoryPoint({
        price: next,
        equity: liveEquity,
        regime: effectiveRegime,
        sentimentScore: sentiment.score,
        sentimentQuality: sentiment.quality,
        sentimentDispersion: sentiment.dispersion,
        tradePrice: event ? next : null,
        tradeSide: null,
        eventStrength: event?.strength ?? 0,
        eventDirection: event?.direction ?? 0,
      })]);
    }, 1000);
    return () => clearInterval(timer);
  }, [running, tradingBlocked, profitStateLoaded, regime, pendingRegime, pendingCount, decisionMultiplier]);

  useEffect(() => {
    if (dailyNetPnl <= -dailyLossLimit) tripKillSwitch("DAILY_LOSS_LIMIT");
    else if (drawdown >= maxDrawdownLimit) tripKillSwitch("MAX_DRAWDOWN");
    else if (equity <= lowLow) tripKillSwitch("LOW_LOW_EQUITY");
    else if (regime === "EXTREME") tripKillSwitch("EXTREME_VOLATILITY");
  }, [dailyNetPnl, drawdown, equity, regime]);

  const reset = () => {
    recordDiagnostic("Simulation reset", { previousTradeCount: trades.length, previousAlertCount: alerts.length });
    const baseline = profitStateRef.current.baseline;
    setRunning(false); setKillSwitch(false); setKillReason(null); setPrice(START_PRICE); setCash(baseline); setPosition(0); setAvgPrice(0);
    setGrossRealized(0); setFeesPaid(0); setTrades([]); setCusumEvents([]); setAlerts([]); setRegime("RANGING"); setPendingRegime(null); setPendingCount(0);
    pricesRef.current = [START_PRICE]; accountRef.current = { cash: baseline, position: 0, avgPrice: 0, gross: 0, fees: 0 }; peakRef.current = baseline;
    cusumRef.current = { positive: 0, negative: 0 };
    setHistory([{ t: Date.now(), label: new Date().toLocaleTimeString(), price: START_PRICE, equity: baseline, regime: "RANGING" }]);
  };

  const cards = [
    ["BTC Price", fmt(price)], ["Equity", fmt(equity)], ["Net P&L", fmt(netPnl)], ["Baseline", fmt(profitBaseline)],
    ["Savings", fmt(savings)], ["Reinvested", fmt(totalInvested)], ["Sweeps", sweepCount],
    ["Regime", regime], ["Strategy", activeStrategy], ["Win Rate", `${(winRate * 100).toFixed(1)}%`], ["Profit Factor", profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)]
  ];

  const statusColor = regime === "TRENDING" ? "bg-emerald-500" : regime === "RANGING" ? "bg-cyan-500" : regime === "VOLATILE" ? "bg-amber-500" : "bg-rose-500";
  const evaluatedCusumEvents = cusumEvents.filter((event) => event.outcomeStatus !== "PENDING");
  const winningCusumEvents = evaluatedCusumEvents.filter((event) => event.outcomeStatus === "WINNER");
  const cusumNetPnl = evaluatedCusumEvents.reduce((total, event) => total + event.netPnl, 0);

  return <div className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8"><div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div><p className="text-sm font-semibold text-cyan-400">AFML + CHAN + SENTIMENT + INDUSTRIAL RISK</p><h1 className="text-3xl font-bold">BTC AI Research Control Room</h1><p className="text-slate-400">One-second monitoring with event-based learning and paper-only execution</p></div>
      <div className="flex flex-wrap gap-2"><Pill color={backendStatus === "CONNECTED" ? "bg-emerald-950 text-emerald-300" : "bg-amber-950 text-amber-300"}>{backendStatus}</Pill><Button disabled={tradingBlocked || !profitStateLoaded} onClick={toggleRunning} className="rounded-2xl bg-cyan-500 text-slate-950">{running ? <Pause className="mr-2 h-4 w-4"/> : <Play className="mr-2 h-4 w-4"/>}{running ? "Pause" : profitStateLoaded ? "Start" : "Loading account…"}</Button><Button onClick={() => killSwitch ? resetKillSwitch() : tripKillSwitch("MANUAL_SHUTDOWN")} className={`rounded-2xl ${killSwitch ? "bg-rose-600" : "bg-slate-700"}`}><Power className="mr-2 h-4 w-4"/>{killSwitch ? "Acknowledge & Reset" : "Kill switch"}</Button><Button onClick={reset} variant="outline" className="rounded-2xl"><RotateCcw className="mr-2 h-4 w-4"/>Reset All</Button></div>
    </header>

    <div className={`flex gap-3 rounded-2xl border p-4 ${tradingBlocked ? "border-rose-800 bg-rose-950/50 text-rose-200" : "border-emerald-800 bg-emerald-950/40 text-emerald-200"}`}>{tradingBlocked ? <AlertTriangle className="h-5 w-5"/> : <ShieldCheck className="h-5 w-5"/>}<div><b>{tradingBlocked ? "Trading blocked" : "Safety system armed"}</b><p className="text-sm opacity-80">{killReason || `Envelope ${envelopeZone} · multiplier ${(decisionMultiplier * 100).toFixed(0)}%`}</p></div></div>

    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">{cards.map(([k,v]) => <Card key={k} className="rounded-2xl border-slate-800 bg-slate-900"><CardContent className="p-4"><p className="text-xs text-slate-400">{k}</p><p className="mt-1 truncate text-xl font-semibold">{v}</p></CardContent></Card>)}</div>

    <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardContent className="flex flex-wrap items-center gap-2 p-4"><span className="mr-2 text-sm font-semibold">Chart layers</span>{Object.entries(visibleLayers).map(([layer, enabled]) => <Button key={layer} size="sm" variant={enabled ? "default" : "outline"} onClick={() => setVisibleLayers((current) => ({ ...current, [layer]: !current[layer] }))} className="capitalize">{layer}</Button>)}<Pill color={sqliteStatus === "CONNECTED" ? "bg-emerald-950 text-emerald-300" : sqliteStatus === "CONNECTING" ? "bg-cyan-950 text-cyan-300" : "bg-rose-950 text-rose-300"}>SQLITE {sqliteStatus}</Pill></CardContent></Card>


    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="rounded-2xl border-slate-800 bg-slate-900 lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-cyan-400"/>Price, equity and CUSUM events</CardTitle></CardHeader><CardContent><div className="h-80"><ResponsiveContainer width="100%" height="100%"><AreaChart data={history}>
                    <CartesianGrid stroke="#1e293b" vertical={false}/>
                    <XAxis dataKey="label" hide/>
                    <YAxis yAxisId="price" domain={["auto", "auto"]} stroke="#22d3ee" width={75}/>
                    <YAxis yAxisId="equity" orientation="right" domain={["auto", "auto"]} stroke="#22c55e" width={75}/>
                    <YAxis yAxisId="sentiment" orientation="right" domain={[-1, 1]} hide/>
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                      formatter={(value, name) => name === "sentimentScore" ? [Number(value).toFixed(2), "Sentiment"] : [fmt(value), name === "price" ? "Market Price" : "Equity"]}
                    />
                    {visibleLayers.price && <Area yAxisId="price" type="monotone" dataKey="price" stroke="#22d3ee" fill="#22d3ee22" isAnimationActive={false}/>}
                    {visibleLayers.equity && <Area yAxisId="equity" type="monotone" dataKey="equity" stroke="#22c55e" fill="#22c55e18" isAnimationActive={false}/>}
                    {visibleLayers.sentiment && <Line yAxisId="sentiment" type="stepAfter" dataKey="sentimentScore" stroke="#a78bfa" strokeWidth={2} dot={false} isAnimationActive={false}/>}
                    {cusumEvents.slice(0, 20).map((e) => (
                      <ReferenceDot key={`event-${e.id}`} yAxisId="price" x={new Date(e.timestamp).toLocaleTimeString()} y={e.price} r={5} fill={e.direction > 0 ? "#22c55e" : "#ef4444"} stroke="#020617"/>
                    ))}
                    {trades.slice(0, 20).map((trade) => (
                      <ReferenceDot key={`trade-${trade.id}`} yAxisId="price" x={new Date(trade.timestamp).toLocaleTimeString()} y={trade.fillPrice} r={7} fill={trade.side === "BUY" ? "#38bdf8" : "#f59e0b"} stroke="#f8fafc" strokeWidth={2}/>
                    ))}
                  </AreaChart></ResponsiveContainer></div><div className="mt-4 flex h-3 overflow-hidden rounded-full">{history.slice(-80).map((h, i) => <div key={i} className={h.regime === "TRENDING" ? "bg-emerald-500" : h.regime === "RANGING" ? "bg-cyan-500" : h.regime === "VOLATILE" ? "bg-amber-500" : "bg-rose-500"} style={{flex:1}} title={`${h.label} ${h.regime}`}/>)}</div></CardContent></Card>
      <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardHeader><CardTitle className="flex items-center gap-2"><Gauge className="h-5 w-5 text-cyan-400"/>Decision Engine</CardTitle></CardHeader><CardContent className="space-y-3"><Metric label="Primary strategy" value={activeStrategy}/><Metric label="Trend strength" value={`${(trendStrength * 100).toFixed(3)}%`}/><Metric label="Mean-reversion z" value={zScore.toFixed(2)}/><Metric label="Meta probability" value={`${(metaProbability * 100).toFixed(0)}%`}/><Metric label="Regime multiplier" value={`${(regimeMultiplier * 100).toFixed(0)}%`}/><Metric label="Sentiment multiplier" value={`${(sentiment.multiplier * 100).toFixed(0)}%`}/><Metric label="Envelope multiplier" value={`${(envelopeMultiplier * 100).toFixed(0)}%`}/><div className={`rounded-xl p-3 text-center font-bold ${decisionMultiplier > .6 ? "bg-emerald-950 text-emerald-300" : decisionMultiplier > .2 ? "bg-amber-950 text-amber-300" : "bg-rose-950 text-rose-300"}`}>FINAL SIZE {(decisionMultiplier * 100).toFixed(0)}%</div></CardContent></Card>
    </div>

    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardHeader><CardTitle className="flex items-center gap-2"><Radio className="h-5 w-5 text-cyan-400"/>CUSUM Event Engine</CardTitle></CardHeader><CardContent className="space-y-3"><Metric label="Positive accumulator" value={(cusumRef.current.positive * 100).toFixed(3) + "%"}/><Metric label="Negative accumulator" value={(cusumRef.current.negative * 100).toFixed(3) + "%"}/><Metric label="Events retained" value={cusumEvents.length}/><Metric label="Evaluated" value={`${evaluatedCusumEvents.length}/${cusumEvents.length}`}/><Metric label="30-minute win rate" value={evaluatedCusumEvents.length ? `${((winningCusumEvents.length / evaluatedCusumEvents.length) * 100).toFixed(1)}%` : "—"}/><Metric label="Event net P&L" value={fmt(cusumNetPnl)} tone={cusumNetPnl >= 0 ? "text-emerald-400" : "text-rose-400"}/><Metric label="Last direction" value={cusumEvents[0] ? (cusumEvents[0].direction > 0 ? "BULLISH" : "BEARISH") : "NONE"}/><Metric label="Last strength" value={cusumEvents[0] ? `${cusumEvents[0].strength.toFixed(2)}×` : "—"}/></CardContent></Card>

      <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardHeader><CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5 text-violet-400"/>Regime & Hysteresis</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex items-center justify-between"><Pill color={`${statusColor} text-slate-950`}>{regime}</Pill><span className="text-sm text-slate-400">{pendingRegime ? `Transition ${pendingCount}/${confirmBars}` : "Stable"}</span></div><Metric label="Volatility" value={`${(volatility * 100).toFixed(3)}%`}/><Metric label="Pending regime" value={pendingRegime || "NONE"}/><Metric label="Confirm bars" value={confirmBars}/><Metric label="Active strategy" value={activeStrategy}/></CardContent></Card>

      <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardHeader><CardTitle>Sentiment Consensus</CardTitle></CardHeader><CardContent className="space-y-3"><Metric label="Score" value={sentiment.score.toFixed(2)} tone={sentiment.score >= 0 ? "text-emerald-400" : "text-rose-400"}/><Metric label="Quality" value={`${(sentiment.quality * 100).toFixed(0)}%`}/><Metric label="Dispersion" value={sentiment.dispersion.toFixed(2)}/><Metric label="Effective sources" value={sentiment.effectiveSources.toFixed(1)}/><Metric label="Status" value={sentiment.status}/></CardContent></Card>

      <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardHeader><CardTitle>Operating Envelope</CardTitle></CardHeader><CardContent className="space-y-2"><Metric label="MAX" value={fmt(maxLevel)}/><Metric label="HIGH HIGH" value={fmt(highHigh)} tone="text-rose-400"/><Metric label="HIGH" value={fmt(high)} tone="text-amber-400"/><div className="rounded-xl bg-cyan-950 p-2 text-center text-cyan-300">CURRENT {fmt(equity)} · {envelopeZone}</div><Metric label="LOW" value={fmt(low)} tone="text-amber-400"/><Metric label="LOW LOW" value={fmt(lowLow)} tone="text-rose-400"/></CardContent></Card>

      <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardHeader><CardTitle>Account &amp; P&amp;L</CardTitle></CardHeader><CardContent className="space-y-3"><Metric label="Position" value={position.toFixed(4)}/><Metric label="Average Entry" value={fmt(avgPrice)}/><Metric label="Cash" value={fmt(cash)}/><Metric label="Savings" value={fmt(savings)}/><Metric label="Baseline" value={fmt(profitBaseline)}/><Metric label="Sweep trigger" value={fmt(profitBaseline + sweepThreshold)}/><Metric label="Sweep transfer target" value={fmt(sweepAmount)}/><Metric label="Reinvested" value={fmt(totalInvested)}/><Metric label="Profit sweeps" value={sweepCount}/><Metric label="Gross Realized" value={fmt(grossRealized)}/><Metric label="Fees Paid" value={fmt(feesPaid)}/>
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <label className="block text-xs text-slate-400" htmlFor="account-baseline">Baseline ($)</label>
          <select id="account-baseline" value={baselineDraft} onChange={(event) => setBaselineDraft(event.target.value)} disabled={running || !profitStateLoaded} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-50">
            {!BASELINE_OPTIONS.includes(Number(baselineDraft)) && <option value={baselineDraft}>{fmt(Number(baselineDraft))} (current)</option>}
            {BASELINE_OPTIONS.map((amount) => <option key={amount} value={amount}>{fmt(amount)}</option>)}
          </select>
          <label className="block text-xs text-slate-400" htmlFor="sweep-threshold">Sweep threshold above baseline ($)</label>
          <input id="sweep-threshold" type="number" min="0.01" step="0.01" value={sweepThresholdDraft} onChange={(event) => setSweepThresholdDraft(event.target.value)} disabled={running || !profitStateLoaded} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"/>
          <label className="block text-xs text-slate-400" htmlFor="sweep-amount">Savings transfer amount ($)</label>
          <select id="sweep-amount" value={sweepAmountDraft} onChange={(event) => setSweepAmountDraft(event.target.value)} disabled={running || !profitStateLoaded} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-50">
            {SWEEP_AMOUNT_OPTIONS.map((amount) => <option key={amount} value={amount}>{fmt(amount)}</option>)}
          </select>
          <p className="text-xs text-slate-500">The threshold triggers a sweep. The selected amount is transferred first, then all remaining cash above baseline also goes to savings. Changing the baseline does not change cash or savings.</p>
          <Button onClick={saveAccountSettings} disabled={running || !profitStateLoaded} className="w-full">{running ? "Pause to edit settings" : "Save account settings"}</Button>
          {accountSettingsMessage && <p role="status" className="text-xs text-slate-400">{accountSettingsMessage}</p>}
        </div>
      </CardContent></Card>
    </div>

    <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardHeader><CardTitle>Trade Signature Engine</CardTitle><p className="text-sm text-slate-400">CUSUM outcomes are evaluated against the directional 30-minute return and linked paper-trade P&L.</p></CardHeader><CardContent><div className="space-y-2">{cusumEvents.slice(0, 10).map((event) => <div key={event.id} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm md:grid-cols-6 md:items-center"><span className="text-slate-400">{new Date(event.timestamp).toLocaleTimeString()}</span><span className={event.direction > 0 ? "text-emerald-400" : "text-rose-400"}>{event.direction > 0 ? "BULLISH" : "BEARISH"} · {event.strength.toFixed(2)}×</span><span>{event.outcomeStatus === "PENDING" ? "Pending 30m window" : `${event.outcomeStatus} ${(event.actualReturn * 100).toFixed(2)}%`}</span><span>{event.tradeOutcome === "PENDING" ? "Trade pending" : event.tradeOutcome === "NO_TRADE" ? "No trade" : `Trade ${event.tradeOutcome}`}</span><span className={event.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}>{event.outcomeStatus === "PENDING" ? "—" : fmt(event.netPnl)}</span><span className="text-right text-xs text-slate-500">{event.outcomeStatus === "PENDING" ? "Awaiting outcome" : event.signalSuccess ? "Signal success" : "Signal failed"}</span></div>)}{cusumEvents.length === 0 && <p className="text-sm text-slate-500">Start the paper simulation to collect CUSUM signatures.</p>}</div></CardContent></Card>

    <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardHeader><CardTitle>Signature Statistics</CardTitle><p className="text-sm text-slate-400">Outcome performance grouped by CUSUM strength. Statistics remain provisional until the sample is large.</p></CardHeader><CardContent>{signatureStats.length === 0 ? <p className="text-sm text-slate-500">No evaluated signatures yet.</p> : <div className="grid gap-3 md:grid-cols-3">{signatureStats.map((stat) => <div key={stat.strength_bucket} className="rounded-xl bg-slate-950 p-3 text-sm"><p className="font-semibold text-cyan-300">CUSUM {stat.strength_bucket}</p><Metric label="Evaluated" value={`${stat.evaluated_count}/${stat.event_count}`}/><Metric label="Win rate" value={`${(Number(stat.win_rate || 0) * 100).toFixed(1)}%`}/><Metric label="Average return" value={`${(Number(stat.average_return || 0) * 100).toFixed(3)}%`}/><Metric label="Average net P&L" value={fmt(stat.average_net_pnl)}/><Metric label="Good loss rate" value={`${(Number(stat.good_loss_rate || 0) * 100).toFixed(1)}%`}/></div>)}</div>}</CardContent></Card>

    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardHeader><CardTitle className="flex items-center gap-2"><Database className="h-5 w-5 text-cyan-400"/>Explainable Paper Trades</CardTitle></CardHeader><CardContent>{trades.length === 0 ? <p className="text-slate-400">No event-approved fills yet.</p> : <div className="max-h-80 space-y-2 overflow-auto">{trades.map((t) => <div key={t.id} className="rounded-xl bg-slate-950 p-3 text-sm"><div className="flex items-center justify-between"><b className={t.side === "BUY" ? "text-emerald-400" : "text-rose-400"}>{t.side} · {t.lifecycle}</b><span>{fmt(t.fillPrice)}</span></div><p className="mt-1 text-slate-400">{t.strategy} · {t.regime} · AI {(t.metaProbability * 100).toFixed(0)}% · final size {(t.decisionMultiplier * 100).toFixed(0)}%</p><p className="text-slate-500">Expected move {(t.expectedMovePct * 100).toFixed(3)}% ({fmt(t.expectedMoveUsd)}) · edge {fmt(t.expectedEdge)}</p><p className="text-slate-500">Expected cost {fmt(t.expectedCost)} · net edge {fmt(t.expectedNetEdge)} · ratio {t.expectedCost > 0 ? (t.expectedEdge / t.expectedCost).toFixed(2) : "—"}x</p><p className="text-slate-500">Slippage {t.slippageBps.toFixed(2)} bps · fee {fmt(t.fee)} · realized {fmt(t.realizedPnl)}{t.classification ? ` · ${t.classification}` : ""}</p>{t.reviewReason && <p className="text-xs text-slate-600">{t.reviewReason}</p>}</div>)}</div>}</CardContent></Card>

      <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5 text-amber-400"/>Alerts & Actions</CardTitle></CardHeader><CardContent>{alerts.length === 0 ? <p className="text-slate-400">No actionable alerts.</p> : <div className="max-h-80 space-y-2 overflow-auto">{alerts.map((a) => <div key={a.id} className={`rounded-xl border p-3 text-sm ${a.severity === "CRITICAL" ? "border-rose-800 bg-rose-950/40" : a.severity === "WARNING" ? "border-amber-800 bg-amber-950/30" : "border-slate-800 bg-slate-950"}`}><div className="flex justify-between"><b>{a.title}</b><span className="text-slate-500">{new Date(a.timestamp).toLocaleTimeString()}</span></div><p className="text-slate-400">{a.message}</p></div>)}</div>}</CardContent></Card>
    </div>

    <div className="grid gap-6 md:grid-cols-2">
      <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardHeader><CardTitle>SQLite Summary</CardTitle></CardHeader><CardContent className="space-y-3"><Metric label="Connection" value={sqliteStatus}/><Metric label="Stored trades" value={resultSummary?.totalTrades ?? trades.length}/><Metric label="Stored trade reviews" value={resultSummary?.tradeReviews ?? 0}/><Metric label="Good loss / bad loss" value={`${resultSummary?.goodLossReviews ?? 0} / ${resultSummary?.badLossReviews ?? 0}`}/><Metric label="Decision logs" value={resultSummary?.decisionLogs ?? 0}/><Metric label="Stored alerts" value={resultSummary?.totalAlerts ?? alerts.length}/><Metric label="Stored CUSUM events" value={resultSummary?.totalCusumEvents ?? cusumEvents.length}/><Metric label="Alert / trade ratio" value={(resultSummary?.alertToTradeRatio ?? 0).toFixed(2)}/><Metric label="Last sync" value={resultSummary?.databaseUpdatedAt ? new Date(resultSummary.databaseUpdatedAt).toLocaleTimeString() : "Waiting"}/></CardContent></Card>
      <Card className="rounded-2xl border-slate-800 bg-slate-900"><CardHeader><CardTitle>Diagnostics</CardTitle></CardHeader><CardContent className="space-y-3"><Metric label="Frontend" value="READY" tone="text-emerald-400"/><Metric label="FastAPI" value={backendStatus} tone={backendStatus === "CONNECTED" ? "text-emerald-400" : "text-amber-400"}/><Metric label="Stored records" value={resultSummary?.totalDiagnostics ?? 0}/><Metric label="Chart samples" value={history.length}/><Metric label="Polling interval" value="5 seconds"/><Metric label="Execution mode" value="PAPER ONLY" tone="text-cyan-400"/></CardContent></Card>
    </div>

    <div className="rounded-2xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200"><b>Review note:</b> This Page integrates the visual and simulation layers: one-second monitoring, CUSUM events, regime routing with adaptive hysteresis, momentum/mean-reversion strategies, sentiment gating, meta-confidence, operating-envelope limits, kill-switch logging, adaptive slippage, and explainable trades. Triple-barrier labeling, PurgedKFold, uniqueness weights, CPCV, SQLite persistence, model registry, and challenger automation belong in the Python backend and are represented here through API-ready fields—not falsely executed in the browser.</div>
  </div></div>;
}
