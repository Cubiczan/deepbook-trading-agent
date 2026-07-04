/**
 * Tests for the CHP decision gate (src/chp/gate.ts)
 *
 * Proves: under-threshold actions LOCK and are allowed; at/over the HITL
 * threshold they require human approval; over the hard max / per-pool /
 * daily caps they are BLOCKED. Also covers the AgentTradingSession wiring.
 */
import { describe, it, expect } from 'vitest';
import { ChpGate } from '../chp/gate.js';
import type { RiskPolicy } from '../chp/policy.js';
import { AgentTradingSession } from '../agent-integration.js';
import { DeepBookClient } from '../deepbook-client.js';
import type { TradingDecision, TradingSessionConfig } from '../types.js';

function makePolicy(overrides: Partial<RiskPolicy> = {}): RiskPolicy {
  return {
    version: 'test',
    maxNotionalUsd: 50000,
    dailyNotionalCapUsd: 250000,
    hitlThresholdUsd: 25000,
    allowedActions: ['swap', 'market_make', 'arbitrage', 'hedge', 'liquidity_provision'],
    perAssetLimits: { '0xpool1': 10000 },
    minConfidence: 0.5,
    ...overrides,
  };
}

describe('ChpGate', () => {
  it('LOCKS an under-threshold action', () => {
    const gate = new ChpGate(makePolicy());
    const d = gate.evaluate({ action: 'swap', poolId: '0xpoolX', notionalUsd: 5000, confidence: 0.8 });
    expect(d.allowed).toBe(true);
    expect(d.requiresHuman).toBe(false);
    expect(d.state).toBe('LOCKED');
  });

  it('requires HITL at/over the threshold', () => {
    const gate = new ChpGate(makePolicy({ hitlThresholdUsd: 25000 }));
    const d = gate.evaluate({ action: 'swap', poolId: '0xpoolX', notionalUsd: 30000, confidence: 0.8 });
    expect(d.allowed).toBe(false);
    expect(d.requiresHuman).toBe(true);
    expect(d.state).toBe('HITL_REQUIRED');
  });

  it('BLOCKS over the hard max notional', () => {
    const gate = new ChpGate(makePolicy({ maxNotionalUsd: 50000 }));
    const d = gate.evaluate({ action: 'swap', poolId: '0xpoolX', notionalUsd: 60000, confidence: 0.9 });
    expect(d.allowed).toBe(false);
    expect(d.state).toBe('BLOCKED');
  });

  it('BLOCKS over a per-pool cap even when under max', () => {
    const gate = new ChpGate(makePolicy());
    const d = gate.evaluate({ action: 'swap', poolId: '0xpool1', notionalUsd: 15000, confidence: 0.9 });
    expect(d.allowed).toBe(false);
    expect(d.provenance.claims.some((c) => c.rule === 'per-pool-cap' && !c.passed)).toBe(true);
  });

  it('allows a zero-notional (unsized) action', () => {
    const gate = new ChpGate(makePolicy());
    const d = gate.evaluate({ action: 'market_make', poolId: '0xpoolX', notionalUsd: 0, confidence: 0.9 });
    expect(d.allowed).toBe(true);
    expect(d.state).toBe('LOCKED');
  });

  it('BLOCKS a low-confidence action', () => {
    const gate = new ChpGate(makePolicy({ minConfidence: 0.6 }));
    const d = gate.evaluate({ action: 'swap', poolId: '0xpoolX', notionalUsd: 100, confidence: 0.2 });
    expect(d.allowed).toBe(false);
    expect(d.provenance.claims.some((c) => c.rule === 'min-confidence' && !c.passed)).toBe(true);
  });

  it('enforces the rolling daily cap', () => {
    const gate = new ChpGate(makePolicy({ dailyNotionalCapUsd: 10000, hitlThresholdUsd: 100000 }));
    expect(gate.evaluate({ action: 'swap', poolId: '0xA', notionalUsd: 4000, confidence: 0.9 }).allowed).toBe(true);
    expect(gate.evaluate({ action: 'swap', poolId: '0xA', notionalUsd: 4000, confidence: 0.9 }).allowed).toBe(true);
    const third = gate.evaluate({ action: 'swap', poolId: '0xA', notionalUsd: 4000, confidence: 0.9 });
    expect(third.allowed).toBe(false);
    expect(third.state).toBe('BLOCKED');
  });

  it('records provenance with a content hash per decision', () => {
    const gate = new ChpGate(makePolicy());
    gate.evaluate({ action: 'swap', poolId: '0xA', notionalUsd: 5000, confidence: 0.8 });
    gate.evaluate({ action: 'swap', poolId: '0xA', notionalUsd: 999999, confidence: 0.8 });
    const ledger = gate.getLedger();
    expect(ledger.length).toBe(2);
    for (const e of ledger) {
      expect(e.decisionId.length).toBeGreaterThan(0);
      expect(e.contentHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe('AgentTradingSession CHP wiring', () => {
  const client = new DeepBookClient();
  const config: TradingSessionConfig = {
    sessionId: 'chp-session',
    allowedPools: ['0xpool1', '0xpool2'],
    maxCapital: '100000',
    riskLimits: { maxPositionPerPool: '50000', maxDrawdownFraction: 0.1, maxDailyTrades: 10 },
  };

  it('blocks an over-max decision at the gate before execution', async () => {
    const gate = new ChpGate(makePolicy({ maxNotionalUsd: 1000, perAssetLimits: {} }));
    const session = new AgentTradingSession({ client, config, chpGate: gate });
    const decision: TradingDecision = {
      action: 'swap',
      poolId: '0xpool1',
      reason: 'oversized swap',
      confidence: 0.9,
      params: { amount: '5000', minOut: '0' },
    };
    const result = await session.executeAgentDecision(decision);
    expect(result.success).toBe(false);
    expect(result.error).toContain('CHP gate');
  });

  it('lets an under-threshold decision through the gate', async () => {
    const gate = new ChpGate(makePolicy({ maxNotionalUsd: 100000, hitlThresholdUsd: 100000, perAssetLimits: {} }));
    const session = new AgentTradingSession({ client, config, chpGate: gate });
    const decision: TradingDecision = {
      action: 'swap',
      poolId: '0xpool1',
      reason: 'small swap',
      confidence: 0.9,
      params: { amount: '100', minOut: '0' },
    };
    const result = await session.executeAgentDecision(decision);
    // Execution may still fail downstream (no signer in tests), but the error
    // must NOT be a CHP-gate rejection — the gate let it through.
    if (!result.success && result.error) {
      expect(result.error).not.toContain('CHP gate');
    }
    // The gate recorded a LOCKED provenance entry for this decision.
    expect(session.chp.getLedger().some((e) => e.state === 'LOCKED')).toBe(true);
  });
});
