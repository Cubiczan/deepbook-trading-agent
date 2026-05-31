/**
 * deepbook-trading-agent — Public API barrel
 *
 * Exports all public types, classes, and functions.
 */

export {
  DeepBookClient,
  DeepBookError,
  OrderNotFoundError,
  PoolNotFoundError,
  InsufficientLiquidityError,
  DEEPBOOK_PACKAGE,
  DEEPBOOK_REGISTRY,
} from './deepbook-client.js';
export type {
  DeepBookClientConfig,
} from './deepbook-client.js';

export {
  PTBTrader,
  WalrusAuditStore,
} from './ptb-trading.js';
export type {
  MarketOrderPTBParams,
  StrategyPTBParams,
  HedgePTBParams,
  WalrusStoreConfig,
} from './ptb-trading.js';

export {
  MarketMakingStrategy,
  ArbitrageStrategy,
  HedgeStrategy,
  LiquidityStrategy,
  BaseStrategy,
} from './strategies.js';
export type {
  StrategyState,
} from './strategies.js';

export {
  AgentTradingSession,
} from './agent-integration.js';
export type {
  AgentSessionOptions,
} from './agent-integration.js';

export type {
  PoolId,
  OrderId,
  OrderSide,
  PoolConfig,
  OrderbookLevel,
  OrderbookSnapshot,
  DepthLevel,
  OrderParams,
  OrderResult,
  SwapResult,
  MarketMakingConfig,
  ArbitrageConfig,
  HedgeConfig,
  LiquidityConfig,
  TradingAction,
  TradingDecision,
  TradeResult,
  TradingSessionConfig,
  TradingReport,
  AuditEntry,
} from './types.js';
