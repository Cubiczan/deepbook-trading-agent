/**
 * deepbook-trading-agent — End-to-End Demo
 *
 * Simulates the complete trading lifecycle:
 * 1. Initialize client and session
 * 2. Create a prediction market pool (YES/NO outcome tokens)
 * 3. Run market making strategy
 * 4. AI agent detects opportunity and executes a trade
 * 5. Store all decisions on Walrus
 * 6. Generate and display P&L report
 *
 * Run with: pnpm tsx src/demo.ts
 */

import { DeepBookClient } from './deepbook-client.js';
import { PTBTrader, WalrusAuditStore } from './ptb-trading.js';
import { MarketMakingStrategy, ArbitrageStrategy } from './strategies.js';
import { AgentTradingSession } from './agent-integration.js';
import type {
  TradingDecision,
  TradingSessionConfig,
  PoolConfig,
  TradingReport,
} from './types.js';

/* ─── Demo Colors ──────────────────────────────────────────────────── */

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function logSection(title: string): void {
  const line = '═'.repeat(60);
  console.log(`\n${colors.bright}${colors.cyan}${line}${colors.reset}`);
  console.log(`${colors.bright}${colors.yellow}  ${title}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}${line}${colors.reset}\n`);
}

function logStep(step: string, detail?: string): void {
  console.log(`  ${colors.green}▸${colors.reset} ${colors.bright}${step}${colors.reset}`);
  if (detail) console.log(`    ${colors.dim}${detail}${colors.reset}`);
}

function logSuccess(msg: string): void {
  console.log(`    ${colors.green}✓${colors.reset} ${msg}`);
}

function logInfo(msg: string): void {
  console.log(`    ${colors.blue}ℹ${colors.reset} ${msg}`);
}

function logWarn(msg: string): void {
  console.log(`    ${colors.yellow}⚠${colors.reset} ${msg}`);
}

function logError(msg: string): void {
  console.log(`    ${colors.red}✗${colors.reset} ${msg}`);
}

/* ─── Simulated Prediction Market ──────────────────────────────────── */

/**
 * Simulated prediction market pool IDs for demo purposes.
 * In production, these would be created on-chain via DeepBookClient.createPool().
 */
const DEMO_POOL_YES = '0xDEMO_PREDICTION_MARKET_YES_POOL';
const DEMO_POOL_NO = '0xDEMO_PREDICTION_MARKET_NO_POOL';

const DEMO_POOL_CONFIG: PoolConfig = {
  baseAsset: 'YES',
  quoteAsset: 'NO',
  tickSize: 0.001,
  lotSize: 1,
  description: 'AI Token Launch Success — Will AGI Token reach $1 by Q3 2026?',
};

/* ─── Simulated AI Agent ───────────────────────────────────────────── */

/**
 * Simulates an AI agent making trading decisions based on market conditions.
 * In production, this would be replaced by a real LLM/AI agent.
 */
function simulateAIAgent(
  sessionId: string,
  poolId: string,
  currentPrice: number
): TradingDecision {
  const volatility = Math.random() * 0.05; // 0-5% random noise
  const sentiment = Math.random(); // random sentiment 0..1

  logSection(`🤖 AI Agent Analysis`);
  logInfo(`Market price: ${currentPrice.toFixed(4)} YES/NO`);
  logInfo(`Volatility: ${(volatility * 100).toFixed(2)}%`);
  logInfo(`Sentiment: ${(sentiment * 100).toFixed(1)}%`);

  if (sentiment > 0.7) {
    // Bullish — start market making to capture spread
    logInfo('Decision logic: Strong sentiment → start market making');
    return {
      action: 'market_make',
      poolId,
      reason: `Bullish sentiment (${(sentiment * 100).toFixed(0)}%) on AI Token prediction market. Starting market making to capture bid-ask spread.`,
      confidence: sentiment,
      params: {
        spreadFraction: 0.02,
        positionSize: '1000',
        refreshIntervalMs: 15000,
        maxPosition: '50000',
        minProfitThreshold: '100',
      },
    };
  } else if (sentiment > 0.4 && volatility > 0.02) {
    // Neutral with volatility — arbitrage opportunity
    const altPrice = currentPrice * (1 + (Math.random() - 0.5) * 0.1);
    logInfo(`Decision logic: Neutral + volatility → arbitrage (alt pool: ${altPrice.toFixed(4)})`);
    return {
      action: 'arbitrage',
      poolId,
      reason: `Price discrepancy detected: ${currentPrice.toFixed(4)} vs ${altPrice.toFixed(4)}. Executing arbitrage.`,
      confidence: 0.85,
      params: {
        poolIds: [poolId, DEMO_POOL_NO],
        minProfitFraction: 0.005,
        maxCapitalPerTrade: '50000',
        checkIntervalMs: 30000,
      },
    };
  } else if (sentiment < 0.3) {
    // Bearish — hedge position
    logInfo('Decision logic: Bearish sentiment → hedge position');
    return {
      action: 'hedge',
      poolId,
      reason: `Bearish outlook (${(sentiment * 100).toFixed(0)}%). Hedging prediction market position across correlated outcomes.`,
      confidence: 0.75,
      params: {
        hedgePools: [DEMO_POOL_NO],
        hedgeRatio: 0.5,
        rebalanceThreshold: '500',
      },
    };
  } else {
    // Neutral — provide liquidity
    logInfo('Decision logic: Neutral → provide liquidity');
    return {
      action: 'liquidity_provision',
      poolId,
      reason: 'Neutral market conditions. Providing liquidity to earn fees.',
      confidence: 0.65,
      params: {
        totalLiquidity: '100000',
        priceLower: '800',
        priceUpper: '1200',
        feeTier: 30,
        rebalanceIntervalMs: 3600000,
      },
    };
  }
}

/* ─── Main Demo ────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  console.log(`\n${colors.bright}${colors.magenta}`);
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║         deepbook-trading-agent — Demo                    ║');
  console.log('  ║  AI-Powered Agentic Trading on DeepBook (Sui)           ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}`);
  console.log(`  Session: Demo | ${new Date().toISOString()}\n`);

  /* ── Step 1: Initialize ────────────────────────────────────────── */

  logSection('📦 Step 1: Initialize Client & Session');

  logStep('Creating DeepBook client', 'Connected to Sui mainnet (read-only demo mode)');
  const client = new DeepBookClient({ network: 'mainnet' });
  const ptbTrader = new PTBTrader(client);
  const walrusStore = new WalrusAuditStore();
  logSuccess('DeepBookClient initialized');
  logSuccess('PTBTrader ready');
  logSuccess('WalrusAuditStore configured');

  logStep('Creating trading session');
  const sessionConfig: TradingSessionConfig = {
    sessionId: `demo-session-${Date.now()}`,
    allowedPools: [DEMO_POOL_YES, DEMO_POOL_NO],
    maxCapital: '500000',
    riskLimits: {
      maxPositionPerPool: '100000',
      maxDrawdownFraction: 0.15,
      maxDailyTrades: 100,
    },
  };

  const session = new AgentTradingSession({
    client,
    config: sessionConfig,
    walrusStore,
  });
  logSuccess(`Session created: ${session.sessionId}`);

  /* ── Step 2: Create Prediction Market Pool ─────────────────────── */

  logSection('🎯 Step 2: Create Prediction Market Pool');

  logStep(
    'Configuring pool',
    `${DEMO_POOL_CONFIG.baseAsset}/${DEMO_POOL_CONFIG.quoteAsset}`
  );
  logInfo(DEMO_POOL_CONFIG.description);

  logStep('Creating pool on-chain (simulated)');

  // In production: const poolId = await client.createPool(DEMO_POOL_CONFIG);
  const poolId = DEMO_POOL_YES;
  logSuccess(`Pool created: ${poolId}`);
  logInfo('YES = "AI Token reaches $1", NO = "AI Token stays below $1"');

  /* ── Step 3: Fetch Orderbook ───────────────────────────────────── */

  logSection('📊 Step 3: Fetch Market Data');

  logStep('Getting orderbook', `Pool: ${poolId}`);
  try {
    const orderbook = await client.getOrderbook(poolId);
    logSuccess(`Orderbook fetched: ${orderbook.bids.length} bids, ${orderbook.asks.length} asks`);
  } catch (err) {
    logWarn(`Orderbook fetch (simulated — pool not on mainnet yet): ${(err as Error).message}`);
    logInfo('Demo continuing with simulated market data');
  }

  logStep('Getting market depth');
  try {
    const depth = await client.getDepth(poolId);
    logSuccess(`Depth levels: ${depth.length}`);
  } catch {
    logWarn('Depth fetch unavailable in demo mode');
  }

  /* ── Step 4: AI Agent Decision ─────────────────────────────────── */

  logSection('🧠 Step 4: AI Agent Detects Opportunity');

  const currentPrice = 1024; // simulated price
  const decision = simulateAIAgent(session.sessionId, poolId, currentPrice);

  logStep(
    'Decision made',
    `${decision.action} (confidence: ${(decision.confidence * 100).toFixed(0)}%)`
  );
  logInfo(`Reason: ${decision.reason}`);

  if (decision.modelSignature) {
    logInfo(`Model: ${decision.modelSignature}`);
  }

  /* ── Step 5: Execute Decision ──────────────────────────────────── */

  logSection('⚡ Step 5: Execute via PTB');

  logStep(
    'Building PTB',
    `Action: ${decision.action} on pool ${decision.poolId.slice(0, 10)}...`
  );

  const result = await session.executeAgentDecision(decision);

  if (result.success) {
    logSuccess('Decision executed successfully');
    if (result.txDigest) logInfo(`Transaction: ${result.txDigest}`);
    if (result.walrusBlobId) logInfo(`Walrus blob: ${result.walrusBlobId}`);
  } else {
    logError(`Execution failed: ${result.error}`);
    logInfo('Demo continuing with partial results');
  }

  /* ── Step 6: Second Decision (simulate another cycle) ──────────── */

  logSection('🔄 Step 6: Second Trading Cycle');

  // Simulate price movement
  const newPrice = currentPrice * (1 + (Math.random() - 0.5) * 0.04);
  const secondDecision = simulateAIAgent(session.sessionId, poolId, newPrice);

  logStep('Second decision', `${secondDecision.action}`);
  const result2 = await session.executeAgentDecision(secondDecision);

  if (result2.success) {
    logSuccess('Second decision executed');
  } else {
    logError(`Execution failed: ${result2.error}`);
  }

  /* ── Step 7: Store Audit on Walrus ─────────────────────────────── */

  logSection('📝 Step 7: Store Audit Trail on Walrus');

  logStep('Getting trading report');
  const report = await session.getAgentReport();
  logSuccess('Report generated');

  logStep('Storing report on Walrus');
  try {
    const blobId = await walrusStore.storeReport(report);
    logSuccess(`Report stored: blob ID ${blobId}`);
    logInfo('On-chain audit trail created — trades are verifiable via Walrus aggregator');
  } catch (err) {
    logWarn(`Walrus storage (simulated): ${(err as Error).message}`);
  }

  /* ── Step 8: Display Report ────────────────────────────────────── */

  logSection('📈 Step 8: Trading Report');

  printReport(report);

  /* ── Step 9: Cleanup ───────────────────────────────────────────── */

  logSection('🧹 Step 9: Cleanup');

  logStep('Stopping all strategies');
  await session.stopAll();
  logSuccess('All strategies stopped');

  /* ── Complete ──────────────────────────────────────────────────── */

  console.log(`\n${colors.bright}${colors.green}`);
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║               Demo Complete ✓                            ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}`);
  console.log(`\n  Summary:`);
  console.log(`  • Client initialized: ${poolId}`);
  console.log(`  • AI decisions executed: ${report.totalTrades}`);
  console.log(`  • Success rate: ${(report.winRate * 100).toFixed(1)}%`);
  console.log(`  • Walrus audit refs: ${report.walrusAuditRefs.length}`);
  console.log(`  • Strategies used: ${session.getStrategyStatuses().map(s => s.name).join(', ') || 'none'}`);
  console.log();
}

/* ─── Report Printer ──────────────────────────────────────────────── */

function printReport(report: TradingReport): void {
  console.log(`  ${colors.bright}Session:${colors.reset} ${report.sessionId}`);
  console.log();
  console.log(`  ${colors.bright}Performance${colors.reset}`);
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  Total Trades:      ${report.totalTrades}`);
  console.log(`  Successful:        ${report.successfulTrades}`);
  console.log(`  Failed:            ${report.failedTrades}`);
  console.log(`  Win Rate:          ${(report.winRate * 100).toFixed(1)}%`);
  console.log(`  Total P&L:         ${report.totalPnl}`);
  console.log();
  console.log(`  ${colors.bright}Open Positions${colors.reset}`);
  console.log(`  ${'─'.repeat(40)}`);

  if (report.openPositions.length === 0) {
    console.log(`  (no open positions)`);
  } else {
    for (const pos of report.openPositions) {
      console.log(
        `  ${pos.poolId.slice(0, 10)}... | ${pos.side.toUpperCase()} | ` +
        `Size: ${pos.size} | Price: ${pos.entryPrice}`
      );
    }
  }

  console.log();
  console.log(`  ${colors.bright}Audit References (Walrus)${colors.reset}`);
  console.log(`  ${'─'.repeat(40)}`);

  if (report.walrusAuditRefs.length === 0) {
    console.log(`  (no audit trail stored)`);
  } else {
    for (const ref of report.walrusAuditRefs) {
      console.log(`  • ${ref}`);
    }
  }

  console.log();
  console.log(`  Generated: ${new Date(report.generatedAt).toISOString()}`);
}

/* ─── Entrypoint ──────────────────────────────────────────────────── */

main().catch((err) => {
  console.error(`\n${colors.red}Demo failed:${colors.reset} ${(err as Error).message}`);
  console.error(err);
  process.exit(1);
});
