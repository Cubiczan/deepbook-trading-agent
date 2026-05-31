/**
 * deepbook-trading-agent — PTB (Programmable Transaction Block) construction
 *
 * Builds atomic, multi-step PTBs for trading operations on DeepBook.
 * Every trade PTB can include a Walrus storage reference for audit trail.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { PoolId, OrderSide, OrderbookSnapshot, TradingReport } from './types.js';
import { DeepBookClient, DEEPBOOK_PACKAGE } from './deepbook-client.js';

/* ─── PTB Builder ──────────────────────────────────────────────────── */

export interface MarketOrderPTBParams {
  poolId: PoolId;
  side: OrderSide;
  amount: string;
  minOut: string;
  /** Blob ID from Walrus if audit reference should be included */
  auditRef?: string;
}

export interface StrategyPTBParams {
  poolId: PoolId;
  bids: { price: string; quantity: string }[];
  asks: { price: string; quantity: string }[];
  auditRef?: string;
}

export interface HedgePTBParams {
  positionPoolId: PoolId;
  hedgePoolIds: PoolId[];
  hedgeAmount: string;
  hedgeRatio: number;
  auditRef?: string;
}

/**
 * Builds PTBs (Programmable Transaction Blocks) for DeepBook trading,
 * each optionally embedding a Walrus blob reference as an on-chain
 * verifiable audit trail.
 */
export class PTBTrader {
  private client: DeepBookClient;

  constructor(client: DeepBookClient) {
    this.client = client;
  }

  /**
   * Build a single-atomic market order PTB.
   *
   * Flow:
   * 1. Call deepbook_v3::pool::swap_exact_input
   * 2. Optionally store audit reference on-chain
   * 3. Transfer output to trader
   */
  buildMarketOrderPTB(params: MarketOrderPTBParams): Transaction {
    const tx = new Transaction();
    const side = params.side === 'bid' ? 0 : 1;

    const [outCoin] = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE}::pool::swap_exact_input`,
      arguments: [
        tx.object(params.poolId),
        tx.pure.u8(side),
        tx.pure.u64(BigInt(params.amount)),
        tx.pure.u64(BigInt(params.minOut)),
      ],
    });

    tx.transferObjects([outCoin], tx.pure.address(this.client.address));

    // Embed Walrus audit reference as a move call argument
    if (params.auditRef) {
      tx.moveCall({
        target: `${DEEPBOOK_PACKAGE}::pool::add_audit_reference`,
        arguments: [
          tx.object(params.poolId),
          tx.pure.string(params.auditRef),
        ],
      });
    }

    return tx;
  }

  /**
   * Build a multi-step strategy PTB that atomically places bid/ask orders
   * across the orderbook.
   */
  buildStrategyPTB(strategy: StrategyPTBParams): Transaction {
    const tx = new Transaction();

    // Place bid orders
    for (const bid of strategy.bids) {
      const [orderId] = tx.moveCall({
        target: `${DEEPBOOK_PACKAGE}::pool::place_order`,
        arguments: [
          tx.object(strategy.poolId),
          tx.pure.u8(0), // bid = 0
          tx.pure.u64(BigInt(bid.price)),
          tx.pure.u64(BigInt(bid.quantity)),
        ],
      });
      tx.transferObjects([orderId], tx.pure.address(this.client.address));
    }

    // Place ask orders
    for (const ask of strategy.asks) {
      const [orderId] = tx.moveCall({
        target: `${DEEPBOOK_PACKAGE}::pool::place_order`,
        arguments: [
          tx.object(strategy.poolId),
          tx.pure.u8(1), // ask = 1
          tx.pure.u64(BigInt(ask.price)),
          tx.pure.u64(BigInt(ask.quantity)),
        ],
      });
      tx.transferObjects([orderId], tx.pure.address(this.client.address));
    }

    // Attach audit reference
    if (strategy.auditRef) {
      tx.moveCall({
        target: `${DEEPBOOK_PACKAGE}::pool::add_audit_reference`,
        arguments: [
          tx.object(strategy.poolId),
          tx.pure.string(strategy.auditRef),
        ],
      });
    }

    return tx;
  }

  /**
   * Build a hedge PTB that hedges an existing position across correlated pools.
   */
  buildHedgePTB(params: HedgePTBParams): Transaction {
    const tx = new Transaction();

    for (const hedgePoolId of params.hedgePoolIds) {
      const hedgeAmount = BigInt(
        Math.round(
          Number(params.hedgeAmount) * params.hedgeRatio / params.hedgePoolIds.length
        )
      );

      const [outCoin] = tx.moveCall({
        target: `${DEEPBOOK_PACKAGE}::pool::swap_exact_input`,
        arguments: [
          tx.object(hedgePoolId),
          tx.pure.u8(1), // sell
          tx.pure.u64(hedgeAmount),
          tx.pure.u64(0n), // no min out for hedge
        ],
      });
      tx.transferObjects([outCoin], tx.pure.address(this.client.address));
    }

    if (params.auditRef) {
      tx.moveCall({
        target: `${DEEPBOOK_PACKAGE}::pool::add_audit_reference`,
        arguments: [
          tx.object(params.positionPoolId),
          tx.pure.string(params.auditRef),
        ],
      });
    }

    return tx;
  }
}

/* ─── Walrus Audit Integration ─────────────────────────────────────── */

export interface WalrusStoreConfig {
  /** Walrus aggregator URL for reads */
  aggregatorUrl?: string;
}

/**
 * Stores trading data on Walrus for a verifiable, permanent audit trail.
 *
 * Uses the Walrus HTTP API (aggregator/publisher endpoints) directly.
 * On-chain storage certification can be done via @mysten/walrus when a
 * signer is available, but for read/store operations the REST API suffices.
 */
export class WalrusAuditStore {
  private aggregatorUrl: string;
  private publisherUrl: string;

  constructor(config: WalrusStoreConfig = {}) {
    this.aggregatorUrl =
      config.aggregatorUrl ?? 'https://aggregator.walrus-testnet.walrus.space';
    this.publisherUrl = 'https://publisher.walrus-testnet.walrus.space';
  }

  /**
   * Store a report blob on Walrus via the publisher API.
   * Returns the blob ID (used as on-chain reference).
   */
  async storeReport(report: TradingReport): Promise<string> {
    const response = await fetch(this.publisherUrl, {
      method: 'PUT',
      body: JSON.stringify(report),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Walrus store failed (${response.status}): ${text}`);
    }

    const result = (await response.json()) as { newlyCreated?: { blobObject?: { id: string } }; alreadyCertified?: { blobId: string } };
    const blobId = result.newlyCreated?.blobObject?.id ?? result.alreadyCertified?.blobId;

    if (!blobId) {
      throw new Error('Walrus store succeeded but no blob ID returned');
    }

    return blobId;
  }

  /**
   * Store raw bytes on Walrus.
   */
  async storeBlob(data: Uint8Array): Promise<string> {
    const response = await fetch(this.publisherUrl, {
      method: 'PUT',
      body: data,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Walrus store failed (${response.status}): ${text}`);
    }

    const result = (await response.json()) as { newlyCreated?: { blobObject?: { id: string } }; alreadyCertified?: { blobId: string } };
    const blobId = result.newlyCreated?.blobObject?.id ?? result.alreadyCertified?.blobId;

    if (!blobId) {
      throw new Error('Walrus store succeeded but no blob ID returned');
    }

    return blobId;
  }

  /**
   * Retrieve a stored report from Walrus by blob ID.
   */
  async retrieveReport(blobId: string): Promise<TradingReport | null> {
    try {
      const response = await fetch(
        `${this.aggregatorUrl}/v1/blobs/${blobId}`
      );
      if (!response.ok) return null;
      return (await response.json()) as TradingReport;
    } catch {
      return null;
    }
  }

  /**
   * Store market snapshot on Walrus.
   */
  async storeSnapshot(snapshot: OrderbookSnapshot): Promise<string> {
    const blob = new TextEncoder().encode(JSON.stringify(snapshot));
    return this.storeBlob(blob);
  }
}
