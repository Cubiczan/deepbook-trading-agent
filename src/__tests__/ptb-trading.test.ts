/**
 * Tests for PTB Construction
 */
import { describe, it, expect } from 'vitest';
import { DeepBookClient } from '../deepbook-client.js';
import { PTBTrader } from '../ptb-trading.js';

describe('PTBTrader', () => {
  const client = new DeepBookClient();
  const ptbTrader = new PTBTrader(client);

  // Valid 64-char hex Sui addresses for testing
  const POOL_1 = '0x0000000000000000000000000000000000000000000000000000000000a11ce';
  const POOL_2 = '0x0000000000000000000000000000000000000000000000000000000000b0b1e';
  const POOL_3 = '0x0000000000000000000000000000000000000000000000000000000000c0ffe';

  it('should build a market order PTB', () => {
    const tx = ptbTrader.buildMarketOrderPTB({
      poolId: POOL_1,
      side: 'bid',
      amount: '1000',
      minOut: '950',
    });
    expect(tx).toBeDefined();
    // PTB should have move calls
    const txData = tx.getData();
    expect(txData).toBeDefined();
  });

  it('should build a strategy PTB with bids and asks', () => {
    const tx = ptbTrader.buildStrategyPTB({
      poolId: POOL_1,
      bids: [
        { price: '900', quantity: '500' },
        { price: '950', quantity: '500' },
      ],
      asks: [
        { price: '1050', quantity: '500' },
        { price: '1100', quantity: '500' },
      ],
    });
    expect(tx).toBeDefined();
  });

  it('should build a hedge PTB', () => {
    const tx = ptbTrader.buildHedgePTB({
      positionPoolId: POOL_1,
      hedgePoolIds: [POOL_2, POOL_3],
      hedgeAmount: '10000',
      hedgeRatio: 0.5,
      referencePrices: { [POOL_2]: '1000', [POOL_3]: '1000' },
    });
    expect(tx).toBeDefined();
  });

  it('should build market order PTB with audit reference', () => {
    const tx = ptbTrader.buildMarketOrderPTB({
      poolId: POOL_1,
      side: 'ask',
      amount: '5000',
      minOut: '4900',
      auditRef: 'walrus-blob-id-123',
    });
    expect(tx).toBeDefined();
  });

  it('should build strategy PTB with audit reference', () => {
    const tx = ptbTrader.buildStrategyPTB({
      poolId: POOL_2,
      bids: [{ price: '800', quantity: '1000' }],
      asks: [{ price: '1200', quantity: '1000' }],
      auditRef: 'walrus-blob-id-456',
    });
    expect(tx).toBeDefined();
  });
});
