/**
 * deepbook-trading-agent — Core type definitions
 *
 * Shared types for DeepBook trading operations, strategies, and agent integration.
 */



/* ─── Pool & Market Types ─────────────────────────────────────────── */

/** Unique identifier for a DeepBook pool */
export type PoolId = string;

/** Unique identifier for a standing order */
export type OrderId = string;

/** Side of the orderbook */
export type OrderSide = 'bid' | 'ask';

/** Configuration for creating a YES/NO prediction market pool */
export interface PoolConfig {
  /** Base asset type (e.g. "YES" token) */
  baseAsset: string;
  /** Quote asset type (e.g. "NO" token) */
  quoteAsset: string;
  /** Tick size for price precision */
  tickSize: number;
  /** Minimum lot size for orders */
  lotSize: number;
  /** Pool description / metadata */
  description?: string;
}

/** A single level in the orderbook */
export interface OrderbookLevel {
  price: string;
  quantity: string;
  total: string;
}

/** Full orderbook snapshot at a given point in time */
export interface OrderbookSnapshot {
  poolId: PoolId;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: number;
}

/** Market depth at a price level */
export interface DepthLevel {
  price: string;
  bidVolume: string;
  askVolume: string;
  spread: string;
}

/* ─── Order Types ─────────────────────────────────────────────────── */

/** Parameters for placing a limit order */
export interface OrderParams {
  poolId: PoolId;
  side: OrderSide;
  price: string;
  quantity: string;
  expiration?: number; // epoch timestamp
}

/** Result of a successful order placement */
export interface OrderResult {
  orderId: OrderId;
  poolId: PoolId;
  side: OrderSide;
  price: string;
  quantity: string;
  timestamp: number;
}

/** Result of a swap (market order execution) */
export interface SwapResult {
  poolId: PoolId;
  amountIn: string;
  amountOut: string;
  price: string;
  fee: string;
  txDigest: string;
  timestamp: number;
}

/* ─── Strategy Types ──────────────────────────────────────────────── */

export interface MarketMakingConfig {
  poolId: PoolId;
  /** Half-spread as fraction of mid price (e.g. 0.01 = 1%) */
  spreadFraction: number;
  /** Position size per side in base tokens */
  positionSize: string;
  /** Interval in ms to refresh orders */
  refreshIntervalMs: number;
  /** Maximum position size before rebalancing */
  maxPosition: string;
  /** Minimum profit threshold for adjustments */
  minProfitThreshold: string;
}

export interface ArbitrageConfig {
  /** Pools to monitor for price discrepancies */
  poolIds: PoolId[];
  /** Minimum profit threshold to execute arbitrage (as fraction) */
  minProfitFraction: number;
  /** Maximum capital to deploy per arbitrage */
  maxCapitalPerTrade: string;
  /** Check interval in ms */
  checkIntervalMs: number;
}

export interface HedgeConfig {
  /** Primary position pool */
  positionPoolId: PoolId;
  /** Correlated pools for hedging */
  hedgePools: PoolId[];
  /** Hedge ratio (0..1) — fraction of position to hedge */
  hedgeRatio: number;
  /** Rebalance threshold for hedge adjustments */
  rebalanceThreshold: string;
}

export interface LiquidityConfig {
  poolId: PoolId;
  /** Total liquidity to provide */
  totalLiquidity: string;
  /** Price range lower bound */
  priceLower: string;
  /** Price range upper bound */
  priceUpper: string;
  /** Target fee tier basis points */
  feeTier: number;
  /** Rebalance interval in ms */
  rebalanceIntervalMs: number;
}

/* ─── Agent / Trading Decision Types ──────────────────────────────── */

export type TradingAction =
  | 'market_make'
  | 'arbitrage'
  | 'hedge'
  | 'liquidity_provision'
  | 'swap';

export interface TradingDecision {
  action: TradingAction;
  poolId: PoolId;
  /** Human-readable reason for the decision */
  reason: string;
  /** Confidence score 0..1 */
  confidence: number;
  /** Parameters specific to the action */
  params: Record<string, unknown>;
  /** AI model signature for auditability */
  modelSignature?: string;
}

export interface TradeResult {
  decision: TradingDecision;
  success: boolean;
  txDigest?: string;
  walrusBlobId?: string;
  error?: string;
  timestamp: number;
}

export interface TradingSessionConfig {
  /** Session identifier */
  sessionId: string;
  /** DeepBook pools this agent may trade on */
  allowedPools: PoolId[];
  /** Maximum capital this agent can deploy */
  maxCapital: string;
  /** Risk limits */
  riskLimits: {
    maxPositionPerPool: string;
    maxDrawdownFraction: number;
    maxDailyTrades: number;
  };
}

export interface TradingReport {
  sessionId: string;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalPnl: string;
  winRate: number;
  openPositions: {
    poolId: PoolId;
    side: OrderSide;
    size: string;
    entryPrice: string;
    unrealizedPnl: string;
  }[];
  tradeHistory: TradeResult[];
  walrusAuditRefs: string[];
  generatedAt: number;
}

/* ─── Walrus Audit Types ──────────────────────────────────────────── */

export interface AuditEntry {
  sessionId: string;
  decisionId: string;
  timestamp: number;
  decision: TradingDecision;
  marketSnapshot: OrderbookSnapshot;
  result: TradeResult;
  pnlImpact: string;
}
