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

  it('should set a non-zero minOut on hedge swaps (slippage/MEV protection)', () => {
    const tx = ptbTrader.buildHedgePTB({
      positionPoolId: POOL_1,
      hedgePoolIds: [POOL_2],
      hedgeAmount: '10000',
      hedgeRatio: 0.5,
      referencePrices: { [POOL_2]: '1000' },
      slippageTolerance: 0.01,
    });

    // swap_exact_input args are [object(pool), u8(side), u64(amount), u64(minOut)].
    // minOut is the 4th argument => pure input index 3, a little-endian u64.
    const data = tx.getData() as unknown as {
      inputs: { Pure?: { bytes: string } }[];
    };
    const minOutInput = data.inputs[3];
    expect(minOutInput?.Pure?.bytes).toBeDefined();
    const minOut = Buffer.from(minOutInput!.Pure!.bytes, 'base64').readBigUInt64LE(0);

    // expectedOut = amount(5000) * price(1000) = 5_000_000; keep 99% => 4_950_000.
    expect(minOut).toBeGreaterThan(0n);
    expect(minOut).toBe(4_950_000n);
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
