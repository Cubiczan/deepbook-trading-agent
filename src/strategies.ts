/**
 * deepbook-trading-agent — Trading Strategies
 *
 * Automated trading strategies for DeepBook prediction markets:
 * - MarketMaking: Places/refreshes bid/ask orders around mid price
 * - Arbitrage: Detects price discrepancies across pools
 * - Hedge: Hedges positions using correlated markets
 * - LiquidityProvision: Provides liquidity to earn fees
 */

import { DeepBookClient } from './deepbook-client.js';
import { PTBTrader } from './ptb-trading.js';
import type {
  PoolId,
  MarketMakingConfig,
  ArbitrageConfig,
  HedgeConfig,
  LiquidityConfig,
  OrderbookSnapshot,
  SwapResult,
  DepthLevel,
} from './types.js';

/* ─── Strategy Base ────────────────────────────────────────────────── */

export interface StrategyState {
  active: boolean;
  startedAt: number;
  totalTrades: number;
  totalPnl: bigint;
}

export abstract class BaseStrategy {
  protected client: DeepBookClient;
  protected ptbTrader: PTBTrader;
  protected state: StrategyState;
  private intervalId?: ReturnType<typeof setInterval>;

  constructor(client: DeepBookClient, ptbTrader: PTBTrader) {
    this.client = client;
    this.ptbTrader = ptbTrader;
    this.state = {
      active: false,
      startedAt: 0,
      totalTrades: 0,
      totalPnl: 0n,
    };
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract getStatus(): Record<string, unknown>;

  protected log(msg: string): void {
    console.log(`[${this.constructor.name}] ${msg}`);
  }

  protected startInterval(fn: () => Promise<void>, ms: number): void {
    this.intervalId = setInterval(() => {
      fn().catch((err) => this.log(`Interval error: ${(err as Error).message}`));
    }, ms);
  }

  protected clearInterval(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}

/* ─── Market Making Strategy ───────────────────────────────────────── */

export class MarketMakingStrategy extends BaseStrategy {
  private config: MarketMakingConfig;

  constructor(
    client: DeepBookClient,
    ptbTrader: PTBTrader,
    config: MarketMakingConfig
  ) {
    super(client, ptbTrader);
    this.config = config;
  }

  async start(): Promise<void> {
    this.state.active = true;
    this.state.startedAt = Date.now();
    this.log(
      `Starting market making on ${this.config.poolId} (spread: ${(this.config.spreadFraction * 100).toFixed(2)}%)`
    );

    await this.refreshOrders();
    this.startInterval(() => this.refreshOrders(), this.config.refreshIntervalMs);
  }

  async stop(): Promise<void> {
    this.state.active = false;
    this.clearInterval();
    this.log('Market making stopped');
  }

  getStatus() {
    return {
      ...this.state,
      poolId: this.config.poolId,
      spreadFraction: this.config.spreadFraction,
      positionSize: this.config.positionSize,
      refreshIntervalMs: this.config.refreshIntervalMs,
    };
  }

  /**
   * Core refresh loop: fetch orderbook, compute prices, replace orders.
   */
  private async refreshOrders(): Promise<void> {
    try {
      const orderbook = await this.client.getOrderbook(this.config.poolId);
      const depth = await this.client.getDepth(this.config.poolId);

      // Calculate mid price from best bid/ask
      const bestBid = orderbook.bids[0]?.price ?? '0';
      const bestAsk = orderbook.asks[0]?.price ?? '0';
      const midPrice =
        BigInt(bestBid) > 0n && BigInt(bestAsk) > 0n
          ? (BigInt(bestBid) + BigInt(bestAsk)) / 2n
          : BigInt(1000); // default if no orders

      const spread = BigInt(Math.round(Number(midPrice) * this.config.spreadFraction));

      const bidPrice = (midPrice - spread).toString();
      const askPrice = (midPrice + spread).toString();

      this.log(
        `Mid: ${midPrice.toString()} | Bid: ${bidPrice} | Ask: ${askPrice}`
      );

      // Build and execute strategy PTB
      const tx = this.ptbTrader.buildStrategyPTB({
        poolId: this.config.poolId,
        bids: [{ price: bidPrice, quantity: this.config.positionSize }],
        asks: [{ price: askPrice, quantity: this.config.positionSize }],
      });

      const digest = await this.client['executeTx'](tx);
      this.state.totalTrades++;
      this.log(`Orders refreshed (tx: ${digest.slice(0, 10)}...)`);
    } catch (err) {
      this.log(`Refresh error: ${(err as Error).message}`);
    }
  }
}

/* ─── Arbitrage Strategy ──────────────────────────────────────────── */

export class ArbitrageStrategy extends BaseStrategy {
  private config: ArbitrageConfig;
  private lastSnapshots: Map<PoolId, OrderbookSnapshot> = new Map();

  constructor(
    client: DeepBookClient,
    ptbTrader: PTBTrader,
    config: ArbitrageConfig
  ) {
    super(client, ptbTrader);
    this.config = config;
  }

  async start(): Promise<void> {
    this.state.active = true;
    this.state.startedAt = Date.now();
    this.log(
      `Starting arbitrage monitoring across ${this.config.poolIds.length} pools`
    );

    await this.checkArbitrage();
    this.startInterval(() => this.checkArbitrage(), this.config.checkIntervalMs);
  }

  async stop(): Promise<void> {
    this.state.active = false;
    this.clearInterval();
    this.log('Arbitrage monitoring stopped');
  }

  getStatus() {
    return {
      ...this.state,
      poolCount: this.config.poolIds.length,
      minProfitFraction: this.config.minProfitFraction,
    };
  }

  /**
   * Monitor pools for price discrepancies and execute arbitrage when profitable.
   */
  private async checkArbitrage(): Promise<void> {
    try {
      const snapshots: Map<PoolId, OrderbookSnapshot> = new Map();

      // Fetch current orderbooks for all monitored pools
      for (const poolId of this.config.poolIds) {
        const ob = await this.client.getOrderbook(poolId);
        snapshots.set(poolId, ob);
      }

      // Compare prices across pools
      for (const [poolA, obA] of snapshots) {
        for (const [poolB, obB] of snapshots) {
          if (poolA >= poolB) continue;

          const bestBidA = BigInt(obA.bids[0]?.price ?? '0');
          const bestAskA = BigInt(obA.asks[0]?.price ?? '0');
          const bestBidB = BigInt(obB.bids[0]?.price ?? '0');
          const bestAskB = BigInt(obB.asks[0]?.price ?? '0');

          if (bestBidA === 0n || bestAskB === 0n) continue;

          // Check: buy on pool B (ask) and sell on pool A (bid)
          const profitBasis = bestBidA - bestAskB;
          const profitFraction =
            bestAskB > 0n ? Number(profitBasis) / Number(bestAskB) : 0;

          if (profitFraction > this.config.minProfitFraction) {
            this.log(
              `Arbitrage opportunity! Buy ${poolB.slice(0, 8)} @ ${bestAskB.toString()} → ` +
              `Sell ${poolA.slice(0, 8)} @ ${bestBidA.toString()} (profit: ${(profitFraction * 100).toFixed(4)}%)`
            );

            // Execute the arbitrage
            const capital = BigInt(this.config.maxCapitalPerTrade);
            const minOut = bestBidA * capital / bestAskB * BigInt(99) / 100n; // 1% slippage tolerance

            const tx = this.ptbTrader.buildMarketOrderPTB({
              poolId: poolB,
              side: 'bid',
              amount: capital.toString(),
              minOut: minOut.toString(),
            });

            this.client['executeTx'](tx).then((digest) => {
              this.state.totalTrades++;
              this.log(`Arbitrage executed (tx: ${digest.slice(0, 10)}...)`);
            }).catch((err) => {
              this.log(`Arbitrage execution failed: ${(err as Error).message}`);
            });
          }
        }
      }

      this.lastSnapshots = snapshots;
    } catch (err) {
      this.log(`Check error: ${(err as Error).message}`);
    }
  }
}

/* ─── Hedge Strategy ──────────────────────────────────────────────── */

export class HedgeStrategy extends BaseStrategy {
  private config: HedgeConfig;
  private positionValue: bigint = 0n;

  constructor(
    client: DeepBookClient,
    ptbTrader: PTBTrader,
    config: HedgeConfig
  ) {
    super(client, ptbTrader);
    this.config = config;
  }

  async start(): Promise<void> {
    this.state.active = true;
    this.state.startedAt = Date.now();
    this.log(
      `Starting hedge strategy for pool ${this.config.positionPoolId.slice(0, 8)}... ` +
      `(ratio: ${(this.config.hedgeRatio * 100).toFixed(1)}%)`
    );

    await this.evaluateHedge();
  }

  async stop(): Promise<void> {
    this.state.active = false;
    this.log('Hedge strategy stopped');
  }

  getStatus() {
    return {
      ...this.state,
      positionPoolId: this.config.positionPoolId,
      hedgePoolCount: this.config.hedgePools.length,
      hedgeRatio: this.config.hedgeRatio,
      positionValue: this.positionValue.toString(),
    };
  }

  /**
   * Evaluate current position and adjust hedges if needed.
   */
  private async evaluateHedge(): Promise<void> {
    try {
      const orderbook = await this.client.getOrderbook(this.config.positionPoolId);
      const depth = await this.client.getDepth(this.config.positionPoolId);

      // Estimate position value from orderbook mid price
      const bestBid = BigInt(orderbook.bids[0]?.price ?? '0');
      const bestAsk = BigInt(orderbook.asks[0]?.price ?? '0');
      const midPrice = bestBid > 0n && bestAsk > 0n
        ? (bestBid + bestAsk) / 2n
        : BigInt(1000);

      this.positionValue = midPrice;

      // Build hedge PTB
      const tx = this.ptbTrader.buildHedgePTB({
        positionPoolId: this.config.positionPoolId,
        hedgePoolIds: this.config.hedgePools,
        hedgeAmount: this.positionValue.toString(),
        hedgeRatio: this.config.hedgeRatio,
      });

      const digest = await this.client['executeTx'](tx);
      this.state.totalTrades++;
      this.log(`Hedge adjusted (tx: ${digest.slice(0, 10)}...)`);
    } catch (err) {
      this.log(`Hedge evaluation error: ${(err as Error).message}`);
    }
  }
}

/* ─── Liquidity Strategy ──────────────────────────────────────────── */

export class LiquidityStrategy extends BaseStrategy {
  private config: LiquidityConfig;

  constructor(
    client: DeepBookClient,
    ptbTrader: PTBTrader,
    config: LiquidityConfig
  ) {
    super(client, ptbTrader);
    this.config = config;
  }

  async start(): Promise<void> {
    this.state.active = true;
    this.state.startedAt = Date.now();
    this.log(
      `Providing liquidity to ${this.config.poolId.slice(0, 8)}... ` +
      `(range: ${this.config.priceLower}–${this.config.priceUpper})`
    );

    await this.provideLiquidity();
    this.startInterval(() => this.provideLiquidity(), this.config.rebalanceIntervalMs);
  }

  async stop(): Promise<void> {
    this.state.active = false;
    this.clearInterval();
    this.log('Liquidity provision stopped');
  }

  getStatus() {
    return {
      ...this.state,
      poolId: this.config.poolId,
      totalLiquidity: this.config.totalLiquidity,
      priceRange: `${this.config.priceLower}–${this.config.priceUpper}`,
      feeTier: this.config.feeTier,
    };
  }

  /**
   * Provide liquidity by placing bid/ask orders within the configured range.
   */
  private async provideLiquidity(): Promise<void> {
    try {
      const lower = BigInt(this.config.priceLower);
      const upper = BigInt(this.config.priceUpper);
      const mid = (lower + upper) / 2n;
      const halfLiquidity = (BigInt(this.config.totalLiquidity) / 2n).toString();

      // Place orders across the range
      const bids = [
        { price: (mid - (mid - lower) / 2n).toString(), quantity: halfLiquidity },
        { price: (mid - (mid - lower) / 4n).toString(), quantity: halfLiquidity },
      ];
      const asks = [
        { price: (mid + (upper - mid) / 4n).toString(), quantity: halfLiquidity },
        { price: (mid + (upper - mid) / 2n).toString(), quantity: halfLiquidity },
      ];

      const tx = this.ptbTrader.buildStrategyPTB({
        poolId: this.config.poolId,
        bids,
        asks,
      });

      const digest = await this.client['executeTx'](tx);
      this.state.totalTrades++;
      this.log(`Liquidity provided (tx: ${digest.slice(0, 10)}...)`);
    } catch (err) {
      this.log(`Liquidity provision error: ${(err as Error).message}`);
    }
  }
}
