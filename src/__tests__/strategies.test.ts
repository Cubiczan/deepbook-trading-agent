/**
 * Tests for Trading Strategies
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeepBookClient } from '../deepbook-client.js';
import { PTBTrader } from '../ptb-trading.js';
import {
  MarketMakingStrategy,
  ArbitrageStrategy,
  HedgeStrategy,
  LiquidityStrategy,
} from '../strategies.js';

describe('MarketMakingStrategy', () => {
  const client = new DeepBookClient();
  const ptbTrader = new PTBTrader(client);

  it('should initialize with config', () => {
    const strategy = new MarketMakingStrategy(client, ptbTrader, {
      poolId: '0xpool',
      spreadFraction: 0.01,
      positionSize: '1000',
      refreshIntervalMs: 60000,
      maxPosition: '100000',
      minProfitThreshold: '100',
    });
    expect(strategy).toBeDefined();
    expect(strategy.getStatus()).toBeDefined();
    expect(strategy.getStatus().poolId).toBe('0xpool');
  });

  it('should start and stop', async () => {
    const strategy = new MarketMakingStrategy(client, ptbTrader, {
      poolId: '0xpool',
      spreadFraction: 0.01,
      positionSize: '1000',
      refreshIntervalMs: 60000,
      maxPosition: '100000',
      minProfitThreshold: '100',
    });
    
    await strategy.start();
    const status = strategy.getStatus();
    expect(status.active).toBe(true);
    expect(status.startedAt).toBeGreaterThan(0);
    expect(status.totalTrades).toBeGreaterThanOrEqual(0);

    await strategy.stop();
    expect(strategy.getStatus().active).toBe(false);
  });

  it('should have correct status shape', () => {
    const strategy = new MarketMakingStrategy(client, ptbTrader, {
      poolId: '0xpool',
      spreadFraction: 0.02,
      positionSize: '5000',
      refreshIntervalMs: 30000,
      maxPosition: '50000',
      minProfitThreshold: '200',
    });
    const status = strategy.getStatus();
    expect(status).toHaveProperty('poolId');
    expect(status).toHaveProperty('spreadFraction');
    expect(status).toHaveProperty('positionSize');
    expect(status).toHaveProperty('refreshIntervalMs');
    expect(status).toHaveProperty('active');
    expect(status).toHaveProperty('startedAt');
    expect(status).toHaveProperty('totalTrades');
    expect(status).toHaveProperty('totalPnl');
  });
});

describe('ArbitrageStrategy', () => {
  const client = new DeepBookClient();
  const ptbTrader = new PTBTrader(client);

  it('should initialize with config', () => {
    const strategy = new ArbitrageStrategy(client, ptbTrader, {
      poolIds: ['0xpool1', '0xpool2'],
      minProfitFraction: 0.005,
      maxCapitalPerTrade: '50000',
      checkIntervalMs: 30000,
    });
    expect(strategy).toBeDefined();
    expect(strategy.getStatus().poolCount).toBe(2);
  });

  it('should start and stop', async () => {
    const strategy = new ArbitrageStrategy(client, ptbTrader, {
      poolIds: ['0xpool1'],
      minProfitFraction: 0.01,
      maxCapitalPerTrade: '10000',
      checkIntervalMs: 60000,
    });
    
    await strategy.start();
    expect(strategy.getStatus().active).toBe(true);
    
    await strategy.stop();
    expect(strategy.getStatus().active).toBe(false);
  });
});

describe('HedgeStrategy', () => {
  const client = new DeepBookClient();
  const ptbTrader = new PTBTrader(client);

  it('should initialize', () => {
    const strategy = new HedgeStrategy(client, ptbTrader, {
      positionPoolId: '0xpool',
      hedgePools: ['0xhedge1', '0xhedge2'],
      hedgeRatio: 0.5,
      rebalanceThreshold: '1000',
    });
    expect(strategy).toBeDefined();
    expect(strategy.getStatus().hedgePoolCount).toBe(2);
    expect(strategy.getStatus().hedgeRatio).toBe(0.5);
  });
});

describe('LiquidityStrategy', () => {
  const client = new DeepBookClient();
  const ptbTrader = new PTBTrader(client);

  it('should initialize', () => {
    const strategy = new LiquidityStrategy(client, ptbTrader, {
      poolId: '0xpool',
      totalLiquidity: '100000',
      priceLower: '800',
      priceUpper: '1200',
      feeTier: 30,
      rebalanceIntervalMs: 3600000,
    });
    expect(strategy).toBeDefined();
    expect(strategy.getStatus().priceRange).toBe('800–1200');
    expect(strategy.getStatus().feeTier).toBe(30);
  });
});
