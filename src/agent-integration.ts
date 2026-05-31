/**
 * deepbook-trading-agent — AI Agent Integration
 *
 * Bridges AI agent decision-making with DeepBook execution.
 * Takes a TradingDecision, validates it, executes via PTBs,
 * and stores the result on Walrus for a verifiable audit trail.
 */

import { DeepBookClient } from './deepbook-client.js';
import { PTBTrader, WalrusAuditStore } from './ptb-trading.js';
import {
  MarketMakingStrategy,
  ArbitrageStrategy,
  HedgeStrategy,
  LiquidityStrategy,
} from './strategies.js';
import type {
  TradingDecision,
  TradingSessionConfig,
  TradingReport,
  TradeResult,
  PoolId,
  AuditEntry,
} from './types.js';

/* ─── Agent Trading Session ────────────────────────────────────────── */

export interface AgentSessionOptions {
  client: DeepBookClient;
  config: TradingSessionConfig;
  walrusStore?: WalrusAuditStore;
}

/**
 * Connects an AI agent's trading decisions to DeepBook execution.
 *
 * The session:
 * 1. Accepts decisions from an AI agent
 * 2. Validates against session config & risk limits
 * 3. Executes via PTBs
 * 4. Stores every decision + result on Walrus
 * 5. Provides P&L reporting
 */
export class AgentTradingSession {
  private client: DeepBookClient;
  private ptbTrader: PTBTrader;
  private config: TradingSessionConfig;
  private walrusStore: WalrusAuditStore;
  private results: TradeResult[] = [];
  private auditRefs: string[] = [];
  private activeStrategies: Map<string, MarketMakingStrategy | ArbitrageStrategy | HedgeStrategy | LiquidityStrategy> = new Map();

  constructor(options: AgentSessionOptions) {
    this.client = options.client;
    this.ptbTrader = new PTBTrader(options.client);
    this.config = options.config;
    this.walrusStore = options.walrusStore ?? new WalrusAuditStore();
  }

  get sessionId(): string {
    return this.config.sessionId;
  }

  /**
   * Execute an AI agent's trading decision.
   *
   * Flow:
   * 1. Validate the decision against session config and risk limits
   * 2. Execute via the appropriate strategy or direct PTB
   * 3. Store the result on Walrus
   * 4. Return the trade result
   */
  async executeAgentDecision(decision: TradingDecision): Promise<TradeResult> {
    const timestamp = Date.now();
    const result: TradeResult = {
      decision,
      success: false,
      timestamp,
    };

    try {
      // 1. Validate
      this.validateDecision(decision);

      // 2. Execute
      switch (decision.action) {
        case 'swap': {
          const amount = decision.params['amount'] as string;
          const minOut = decision.params['minOut'] as string;
          const swapResult = await this.client.swapExactInput(
            decision.poolId,
            amount,
            minOut ?? '0'
          );
          result.txDigest = swapResult.txDigest;
          break;
        }

        case 'market_make': {
          // Start market making strategy if not already running
          const key = `mm-${decision.poolId}`;
          if (!this.activeStrategies.has(key)) {
            const strategy = new MarketMakingStrategy(
              this.client,
              this.ptbTrader,
              {
                poolId: decision.poolId,
                spreadFraction: (decision.params['spreadFraction'] as number) ?? 0.01,
                positionSize: (decision.params['positionSize'] as string) ?? '1000',
                refreshIntervalMs: (decision.params['refreshIntervalMs'] as number) ?? 60000,
                maxPosition: (decision.params['maxPosition'] as string) ?? '100000',
                minProfitThreshold: (decision.params['minProfitThreshold'] as string) ?? '100',
              }
            );
            this.activeStrategies.set(key, strategy);
            await strategy.start();
          }
          break;
        }

        case 'arbitrage': {
          const strategy = new ArbitrageStrategy(
            this.client,
            this.ptbTrader,
            {
              poolIds: (decision.params['poolIds'] as PoolId[]) ?? [decision.poolId],
              minProfitFraction: (decision.params['minProfitFraction'] as number) ?? 0.005,
              maxCapitalPerTrade: (decision.params['maxCapitalPerTrade'] as string) ?? '50000',
              checkIntervalMs: (decision.params['checkIntervalMs'] as number) ?? 30000,
            }
          );
          this.activeStrategies.set(`arb-${Date.now()}`, strategy);
          await strategy.start();
          break;
        }

        case 'hedge': {
          const strategy = new HedgeStrategy(
            this.client,
            this.ptbTrader,
            {
              positionPoolId: decision.poolId,
              hedgePools: (decision.params['hedgePools'] as PoolId[]) ?? [],
              hedgeRatio: (decision.params['hedgeRatio'] as number) ?? 0.5,
              rebalanceThreshold: (decision.params['rebalanceThreshold'] as string) ?? '1000',
            }
          );
          this.activeStrategies.set(`hedge-${decision.poolId}`, strategy);
          await strategy.start();
          break;
        }

        case 'liquidity_provision': {
          const strategy = new LiquidityStrategy(
            this.client,
            this.ptbTrader,
            {
              poolId: decision.poolId,
              totalLiquidity: (decision.params['totalLiquidity'] as string) ?? '100000',
              priceLower: (decision.params['priceLower'] as string) ?? '800',
              priceUpper: (decision.params['priceUpper'] as string) ?? '1200',
              feeTier: (decision.params['feeTier'] as number) ?? 30,
              rebalanceIntervalMs: (decision.params['rebalanceIntervalMs'] as number) ?? 3600000,
            }
          );
          this.activeStrategies.set(`lp-${decision.poolId}`, strategy);
          await strategy.start();
          break;
        }
      }

      result.success = true;

      // 3. Store on Walrus
      try {
        const auditEntry: AuditEntry = {
          sessionId: this.config.sessionId,
          decisionId: `${timestamp}-${decision.poolId.slice(0, 8)}`,
          timestamp,
          decision,
          marketSnapshot: await this.client.getOrderbook(decision.poolId),
          result,
          pnlImpact: '0', // Would be calculated from actual fills
        };

        const blob = new TextEncoder().encode(JSON.stringify(auditEntry));
        const blobId = await this.walrusStore.storeBlob(blob);
        result.walrusBlobId = blobId;
        this.auditRefs.push(blobId);
      } catch (walrusErr) {
        // Non-fatal: if Walrus store fails, execution still succeeded
        console.warn(`Walrus audit store failed: ${(walrusErr as Error).message}`);
      }

      this.results.push(result);
    } catch (err) {
      result.success = false;
      result.error = (err as Error).message;
      this.results.push(result);
    }

    return result;
  }

  /**
   * Validate a trading decision against session config and risk limits.
   */
  private validateDecision(decision: TradingDecision): void {
    // Check pool is allowed
    if (!this.config.allowedPools.includes(decision.poolId)) {
      throw new Error(
        `Pool ${decision.poolId} not in allowed pools for this session`
      );
    }

    // Check daily trade limit
    const todayTrades = this.results.filter((r) => {
      const d = new Date(r.timestamp);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length;

    if (todayTrades >= this.config.riskLimits.maxDailyTrades) {
      throw new Error(
        `Daily trade limit reached (${todayTrades}/${this.config.riskLimits.maxDailyTrades})`
      );
    }

    // Validate decision confidence
    if (decision.confidence < 0.5) {
      console.warn(
        `Low confidence decision: ${decision.confidence}. Consider reviewing before execution.`
      );
    }
  }

  /**
   * Generate a comprehensive trading report for this session.
   */
  async getAgentReport(): Promise<TradingReport> {
    const successful = this.results.filter((r) => r.success);
    const failed = this.results.filter((r) => !r.success);

    // Calculate positions from latest orderbook snapshots
    const openPositions: TradingReport['openPositions'] = [];
    for (const poolId of this.config.allowedPools) {
      try {
        const ob = await this.client.getOrderbook(poolId);
        const bestBid = ob.bids[0];
        const bestAsk = ob.asks[0];
        if (bestBid) {
          openPositions.push({
            poolId,
            side: 'bid',
            size: bestBid.quantity,
            entryPrice: bestBid.price,
            unrealizedPnl: '0',
          });
        }
        if (bestAsk) {
          openPositions.push({
            poolId,
            side: 'ask',
            size: bestAsk.quantity,
            entryPrice: bestAsk.price,
            unrealizedPnl: '0',
          });
        }
      } catch {
        // Pool might not be queryable
      }
    }

    return {
      sessionId: this.config.sessionId,
      totalTrades: this.results.length,
      successfulTrades: successful.length,
      failedTrades: failed.length,
      totalPnl: '0', // Would require fill data
      winRate: this.results.length > 0
        ? successful.length / this.results.length
        : 0,
      openPositions,
      tradeHistory: [...this.results],
      walrusAuditRefs: [...this.auditRefs],
      generatedAt: Date.now(),
    };
  }

  /**
   * Stop all active strategies.
   */
  async stopAll(): Promise<void> {
    for (const [name, strategy] of this.activeStrategies) {
      await strategy.stop();
      console.log(`Stopped strategy: ${name}`);
    }
    this.activeStrategies.clear();
  }

  /**
   * Get status of all active strategies.
   */
  getStrategyStatuses(): Record<string, unknown>[] {
    const statuses: Record<string, unknown>[] = [];
    for (const [name, strategy] of this.activeStrategies) {
      statuses.push({
        name,
        ...strategy.getStatus(),
      });
    }
    return statuses;
  }
}
