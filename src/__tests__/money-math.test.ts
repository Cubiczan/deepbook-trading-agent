/**
 * Characterization + edge-case tests for the money/math critical path.
 *
 * Covers the pure formulas extracted from the strategy execution paths:
 *  - computeMidPrice      (market-making mid)
 *  - computeQuote         (market-making bid/ask spread)
 *  - computeProfitFraction (arbitrage spread / profitability)
 *  - computeArbMinOut     (arbitrage slippage-protected minOut)
 *
 * plus the hedge minOut math inside PTBTrader.buildHedgePTB (slippage/MEV
 * protection per pool), inspected via the encoded PTB inputs.
 *
 * Expected values below are computed by hand from the documented formulas so a
 * regression in the math (e.g. wrong division order, dropped slippage haircut,
 * or div-by-zero) fails the test rather than silently mispricing trades.
 */
import { describe, it, expect } from 'vitest';
import {
  computeMidPrice,
  computeQuote,
  computeProfitFraction,
  computeArbMinOut,
} from '../strategies.js';
import { DeepBookClient } from '../deepbook-client.js';
import { PTBTrader } from '../ptb-trading.js';

/** Decode a u64 little-endian Pure input from an encoded Transaction. */
function readU64Input(tx: { getData: () => unknown }, index: number): bigint {
  const data = tx.getData() as unknown as {
    inputs: { Pure?: { bytes: string } }[];
  };
  const input = data.inputs[index];
  if (!input?.Pure?.bytes) {
    throw new Error(`input ${index} is not a Pure u64`);
  }
  return Buffer.from(input.Pure.bytes, 'base64').readBigUInt64LE(0);
}

describe('computeMidPrice (market-making mid)', () => {
  it('averages best bid and ask with integer (truncating) division', () => {
    // (100 + 110) / 2 = 105
    expect(computeMidPrice(100n, 110n)).toBe(105n);
  });

  it('truncates toward zero on odd sums (does not round up)', () => {
    // (100 + 101) / 2 = 100.5 -> 100 (BigInt truncation)
    expect(computeMidPrice(100n, 101n)).toBe(100n);
  });

  it('falls back to default when the bid side is empty/zero', () => {
    expect(computeMidPrice(0n, 110n)).toBe(1000n);
  });

  it('falls back to default when the ask side is empty/zero', () => {
    expect(computeMidPrice(100n, 0n)).toBe(1000n);
  });

  it('falls back when both sides are zero (never quotes around 0)', () => {
    expect(computeMidPrice(0n, 0n)).toBe(1000n);
  });

  it('honors an explicit fallback', () => {
    expect(computeMidPrice(0n, 0n, 500n)).toBe(500n);
  });

  it('handles large values without precision loss (no Number coercion)', () => {
    const big = 10_000_000_000_000_000_000n; // > Number.MAX_SAFE_INTEGER
    expect(computeMidPrice(big, big)).toBe(big);
  });
});

describe('computeQuote (market-making spread)', () => {
  it('places symmetric bid/ask around mid for a 1% spread', () => {
    // spread = round(1000 * 0.01) = 10
    const q = computeQuote(1000n, 0.01);
    expect(q.spread).toBe(10n);
    expect(q.bidPrice).toBe(990n);
    expect(q.askPrice).toBe(1010n);
  });

  it('rounds the spread to the nearest integer', () => {
    // round(1005 * 0.01) = round(10.05) = 10
    expect(computeQuote(1005n, 0.01).spread).toBe(10n);
    // round(1055 * 0.01) = round(10.55) = 11
    expect(computeQuote(1055n, 0.01).spread).toBe(11n);
  });

  it('produces a zero spread (bid == ask == mid) when fraction is 0', () => {
    const q = computeQuote(1000n, 0);
    expect(q.spread).toBe(0n);
    expect(q.bidPrice).toBe(1000n);
    expect(q.askPrice).toBe(1000n);
  });

  it('can drive the bid below zero for a wide spread (caller must guard)', () => {
    // characterizes current behavior: spread can exceed mid
    const q = computeQuote(100n, 2); // spread = 200
    expect(q.spread).toBe(200n);
    expect(q.bidPrice).toBe(-100n);
    expect(q.askPrice).toBe(300n);
  });
});

describe('computeProfitFraction (arbitrage spread)', () => {
  it('computes positive profit when sell price exceeds buy price', () => {
    // (110 - 100) / 100 = 0.10
    expect(computeProfitFraction(110n, 100n)).toBeCloseTo(0.1, 12);
  });

  it('computes negative profit when buy price exceeds sell price', () => {
    // (90 - 100) / 100 = -0.10
    expect(computeProfitFraction(90n, 100n)).toBeCloseTo(-0.1, 12);
  });

  it('returns 0 profit when prices are equal', () => {
    expect(computeProfitFraction(100n, 100n)).toBe(0);
  });

  it('returns 0 (not NaN/Infinity) when the buy-side ask is zero', () => {
    // div-by-zero guard: must not produce Infinity which would pass a > threshold check
    expect(computeProfitFraction(100n, 0n)).toBe(0);
  });

  it('treats a negative ask defensively as no opportunity', () => {
    expect(computeProfitFraction(100n, -5n)).toBe(0);
  });
});

describe('computeArbMinOut (arbitrage slippage-protected minOut)', () => {
  it('applies the price ratio then a 1% slippage haircut', () => {
    // (bestBidA * capital / bestAskB) * 9900 / 10000
    // (110 * 10000 / 100) * 9900 / 10000 = 11000 * 9900 / 10000 = 10890
    expect(computeArbMinOut(110n, 100n, 10_000n, 100n)).toBe(10_890n);
  });

  it('matches the legacy inline formula bestBidA*capital/bestAskB*99/100', () => {
    const bestBidA = 137n;
    const bestAskB = 91n;
    const capital = 50_000n;
    const legacy = (bestBidA * capital) / bestAskB * 99n / 100n;
    expect(computeArbMinOut(bestBidA, bestAskB, capital, 100n)).toBe(legacy);
  });

  it('preserves division ORDER: ratio before haircut (not capital*keep/10000 first)', () => {
    // bestBidA=1, bestAskB=3, capital=10: ratio first => floor(1*10/3)=3, *9900/10000 = floor(29700/10000)=2.
    // If someone reordered to (capital*9900/10000)*bid/ask they'd get floor(10*9900/10000)=9, *1/3=3 -> wrong.
    expect(computeArbMinOut(1n, 3n, 10n, 100n)).toBe(2n);
  });

  it('zero tolerance keeps the full expected output', () => {
    // (110 * 10000 / 100) * 10000 / 10000 = 11000
    expect(computeArbMinOut(110n, 100n, 10_000n, 0n)).toBe(11_000n);
  });

  it('returns 0 (not a throw / NaN) when the buy-side ask is zero', () => {
    expect(computeArbMinOut(110n, 0n, 10_000n, 100n)).toBe(0n);
  });

  it('uses integer truncation, never producing fractional units', () => {
    const out = computeArbMinOut(7n, 13n, 1234n, 100n);
    expect(out).toBe((7n * 1234n) / 13n * 9900n / 10_000n);
    expect(out % 1n).toBe(0n);
  });
});

describe('PTBTrader.buildHedgePTB (hedge minOut per pool)', () => {
  const client = new DeepBookClient();
  const ptbTrader = new PTBTrader(client);
  const POOL_A = '0x0000000000000000000000000000000000000000000000000000000000a11ce';
  const POOL_B = '0x0000000000000000000000000000000000000000000000000000000000b0b1e';

  it('computes hedgeAmount and minOut for a single pool (1% default tolerance)', () => {
    // hedgeAmount = round(10000 * 0.5 / 1) = 5000
    // expectedOut = 5000 * 1000 = 5_000_000 ; keep 99% => 4_950_000
    const tx = ptbTrader.buildHedgePTB({
      positionPoolId: POOL_A,
      hedgePoolIds: [POOL_B],
      hedgeAmount: '10000',
      hedgeRatio: 0.5,
      referencePrices: { [POOL_B]: '1000' },
    });
    // inputs: [object(pool), u8(side)=1, u64(amount), u64(minOut)]
    expect(readU64Input(tx, 2)).toBe(5000n);
    expect(readU64Input(tx, 3)).toBe(4_950_000n);
  });

  it('splits the hedge amount evenly across multiple pools', () => {
    // hedgeAmount per pool = round(10000 * 0.5 / 2) = 2500
    // expectedOut = 2500 * 1000 = 2_500_000 ; keep 99% => 2_475_000
    const tx = ptbTrader.buildHedgePTB({
      positionPoolId: POOL_A,
      hedgePoolIds: [POOL_A, POOL_B],
      hedgeAmount: '10000',
      hedgeRatio: 0.5,
      referencePrices: { [POOL_A]: '1000', [POOL_B]: '1000' },
    });
    // First swap occupies pure inputs after the object; amount is input index 2, minOut index 3.
    expect(readU64Input(tx, 2)).toBe(2500n);
    expect(readU64Input(tx, 3)).toBe(2_475_000n);
  });

  it('yields minOut = 0 when no reference price is available (cannot bound output)', () => {
    // refPrice falls back to 0 => expectedOut 0 => minOut 0.
    const tx = ptbTrader.buildHedgePTB({
      positionPoolId: POOL_A,
      hedgePoolIds: [POOL_B],
      hedgeAmount: '10000',
      hedgeRatio: 0.5,
      referencePrices: {}, // missing entry
    });
    expect(readU64Input(tx, 3)).toBe(0n);
  });

  it('clamps a >100% slippage tolerance to 100% (minOut floored at 0, never negative)', () => {
    // tolerance 1.5 clamps to 1.0 => keepBps 0 => minOut 0 (and no negative bigint).
    const tx = ptbTrader.buildHedgePTB({
      positionPoolId: POOL_A,
      hedgePoolIds: [POOL_B],
      hedgeAmount: '10000',
      hedgeRatio: 0.5,
      referencePrices: { [POOL_B]: '1000' },
      slippageTolerance: 1.5,
    });
    expect(readU64Input(tx, 3)).toBe(0n);
  });

  it('clamps a negative slippage tolerance to 0 (requires full expected output)', () => {
    // tolerance -0.5 clamps to 0 => keepBps 10000 => minOut == expectedOut = 5_000_000.
    const tx = ptbTrader.buildHedgePTB({
      positionPoolId: POOL_A,
      hedgePoolIds: [POOL_B],
      hedgeAmount: '10000',
      hedgeRatio: 0.5,
      referencePrices: { [POOL_B]: '1000' },
      slippageTolerance: -0.5,
    });
    expect(readU64Input(tx, 3)).toBe(5_000_000n);
  });

  it('applies a custom 5% slippage tolerance (keep 95%)', () => {
    // expectedOut = 5000 * 1000 = 5_000_000 ; keep 95% => 4_750_000
    const tx = ptbTrader.buildHedgePTB({
      positionPoolId: POOL_A,
      hedgePoolIds: [POOL_B],
      hedgeAmount: '10000',
      hedgeRatio: 0.5,
      referencePrices: { [POOL_B]: '1000' },
      slippageTolerance: 0.05,
    });
    expect(readU64Input(tx, 3)).toBe(4_750_000n);
  });
});
