/**
 * Tests for Agent Integration
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DeepBookClient } from '../deepbook-client.js';
import { AgentTradingSession } from '../agent-integration.js';
import type { TradingDecision, TradingSessionConfig } from '../types.js';

describe('AgentTradingSession', () => {
  const client = new DeepBookClient();
  const config: TradingSessionConfig = {
    sessionId: 'test-session-1',
    allowedPools: ['0xpool1', '0xpool2'],
    maxCapital: '100000',
    riskLimits: {
      maxPositionPerPool: '50000',
      maxDrawdownFraction: 0.1,
      maxDailyTrades: 10,
    },
  };

  it('should create a session', () => {
    const session = new AgentTradingSession({ client, config });
    expect(session.sessionId).toBe('test-session-1');
  });

  it('should reject decisions for disallowed pools', async () => {
    const session = new AgentTradingSession({ client, config });
    const badDecision: TradingDecision = {
      action: 'swap',
      poolId: '0xunauthorized',
      reason: 'Testing rejection',
      confidence: 0.9,
      params: {},
    };
    const result = await session.executeAgentDecision(badDecision);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not in allowed pools');
  });

  it('should generate a report', async () => {
    const session = new AgentTradingSession({ client, config });
    const report = await session.getAgentReport();
    expect(report.sessionId).toBe('test-session-1');
    expect(report.totalTrades).toBe(0);
    expect(report.successfulTrades).toBe(0);
    expect(report.failedTrades).toBe(0);
    expect(report.winRate).toBe(0);
    expect(report.generatedAt).toBeGreaterThan(0);
  });

  it('should report strategy statuses', () => {
    const session = new AgentTradingSession({ client, config });
    const statuses = session.getStrategyStatuses();
    expect(Array.isArray(statuses)).toBe(true);
  });

  it('should validate confidence threshold', async () => {
    const session = new AgentTradingSession({ client, config });
    const lowConfidenceDecision: TradingDecision = {
      action: 'swap',
      poolId: '0xpool1',
      reason: 'Low confidence test',
      confidence: 0.3,
      params: {},
    };
    // Low confidence should log warning but still try to validate
    const result = await session.executeAgentDecision(lowConfidenceDecision);
    expect(result.error).toBeDefined(); // Will fail on execution since no keypair
  });

  it('should stop all strategies', async () => {
    const session = new AgentTradingSession({ client, config });
    await session.stopAll();
    expect(session.getStrategyStatuses().length).toBe(0);
  });
});
