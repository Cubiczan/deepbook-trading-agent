/**
 * deepbook-trading-agent — Low-level DeepBook client
 *
 * Provides the foundational layer for interacting with DeepBook (Sui's on-chain
 * orderbook). Uses PTB construction via @mysten/sui/transactions for all
 * operations.
 */

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type {
  PoolId,
  OrderId,
  OrderSide,
  PoolConfig,
  OrderbookSnapshot,
  OrderbookLevel,
  DepthLevel,
  OrderParams,
  OrderResult,
  SwapResult,
} from './types.js';

/* ─── Constants ─────────────────────────────────────────────────────── */

/** DeepBook mainnet package IDs (as of Sui mainnet) */
export const DEEPBOOK_PACKAGE =
  '0x000000000000000000000000000000000000000000000000000000000000dee9';

/** DeepBook V3 pool registry object ID */
export const DEEPBOOK_REGISTRY =
  '0x0';

/** Default gas budget for DeepBook transactions */
const DEFAULT_GAS_BUDGET = 10_000_000n;

/* ─── Error Types ──────────────────────────────────────────────────── */

export class DeepBookError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'DeepBookError';
  }
}

export class OrderNotFoundError extends DeepBookError {
  constructor(orderId: OrderId) {
    super(`Order not found: ${orderId}`, 'ORDER_NOT_FOUND');
  }
}

export class PoolNotFoundError extends DeepBookError {
  constructor(poolId: PoolId) {
    super(`Pool not found: ${poolId}`, 'POOL_NOT_FOUND');
  }
}

export class InsufficientLiquidityError extends DeepBookError {
  constructor(poolId: PoolId, side: OrderSide) {
    super(
      `Insufficient liquidity on ${side} side for pool ${poolId}`,
      'INSUFFICIENT_LIQUIDITY'
    );
  }
}

/* ─── DeepBookClient ───────────────────────────────────────────────── */

export interface DeepBookClientConfig {
  /** Network: 'mainnet' | 'testnet' | 'devnet' | custom RPC URL */
  network?: string;
  /** Optional keypair for signing. If omitted, read-only queries work */
  keypair?: Ed25519Keypair;
  /** Gas budget in MIST */
  gasBudget?: bigint;
}

/**
 * Low-level DeepBook client providing pool management, order placement,
 * cancellation, orderbook queries, and swap execution.
 */
export class DeepBookClient {
  public readonly client: SuiJsonRpcClient;
  public readonly keypair?: Ed25519Keypair;
  private readonly gasBudget: bigint;

  constructor(config: DeepBookClientConfig = {}) {
    const network = config.network ?? 'mainnet';
    const rpcUrl = network.startsWith('http')
      ? network
      : getJsonRpcFullnodeUrl(network as 'mainnet' | 'testnet' | 'devnet');

    this.client = new SuiJsonRpcClient({ url: rpcUrl });
    this.keypair = config.keypair;
    this.gasBudget = config.gasBudget ?? DEFAULT_GAS_BUDGET;
  }

  /**
   * Get the address of the configured keypair, or a zero address if none set.
   */
  get address(): string {
    return this.keypair?.toSuiAddress() ?? '0x0000000000000000000000000000000000000000';
  }

  /**
   * Sign and execute a TransactionBlock.
   * Returns the transaction digest on success.
   */
  async executeTx(tx: Transaction): Promise<string> {
    if (!this.keypair) {
      throw new DeepBookError(
        'Keypair required to execute transactions',
        'KEYPAIR_REQUIRED'
      );
    }

    tx.setSenderIfNotSet(this.address);

    // Execute with effects + events in the response
    const result = await this.client.signAndExecuteTransaction({
      signer: this.keypair,
      transaction: tx,
    });

    if (result.$kind === 'FailedTransaction') {
      throw new DeepBookError(
        `Transaction failed`,
        'TX_EXECUTION_FAILED',
        result
      );
    }

    // Wait for the transaction with effects included
    const txResult = await this.client.waitForTransaction({
      digest: result.Transaction.digest,
    });

    if (txResult.$kind === 'FailedTransaction') {
      throw new DeepBookError(
        `Transaction failed after submission`,
        'TX_EXECUTION_FAILED',
        txResult
      );
    }

    // Check status on the settled transaction (effects must be requested)
    if (txResult.Transaction.effects?.status?.status !== 'success') {
      const error = txResult.Transaction.effects?.status?.error ?? 'unknown error';
      throw new DeepBookError(
        `Transaction failed: ${error}`,
        'TX_EXECUTION_FAILED',
        txResult
      );
    }

    return result.Transaction.digest;
  }

  /* ─── Pool Operations ─────────────────────────────────────────────── */

  /**
   * Create a new YES/NO prediction market pool on DeepBook.
   */
  async createPool(config: PoolConfig): Promise<PoolId> {
    const tx = new Transaction();

    const [pool] = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE}::pool::new_pool`,
      arguments: [
        tx.pure.string(config.baseAsset),
        tx.pure.string(config.quoteAsset),
        tx.pure.u64(BigInt(Math.round(config.tickSize * 1_000_000_000))),
        tx.pure.u64(BigInt(Math.round(config.lotSize * 1_000_000_000))),
      ],
    });

    tx.moveCall({
      target: `${DEEPBOOK_PACKAGE}::pool::register_pool`,
      arguments: [
        tx.object(DEEPBOOK_REGISTRY),
        pool,
        tx.pure.string(config.description ?? `Prediction market: ${config.baseAsset}/${config.quoteAsset}`),
      ],
    });

    tx.transferObjects([pool], tx.pure.address(this.address));

    const digest = await this.executeTx(tx);

    return digest;
  }

  /**
   * Place a limit order on a DeepBook pool.
   */
  async placeOrder(params: OrderParams): Promise<OrderResult> {
    const tx = new Transaction();

    const orderId = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE}::pool::place_order`,
      arguments: [
        tx.object(params.poolId),
        tx.pure.u8(params.side === 'bid' ? 0 : 1),
        tx.pure.u64(BigInt(params.price)),
        tx.pure.u64(BigInt(params.quantity)),
      ],
    });

    tx.transferObjects([orderId], tx.pure.address(this.address));

    const digest = await this.executeTx(tx);

    return {
      orderId: digest, // In production, parse from transaction events
      poolId: params.poolId,
      side: params.side,
      price: params.price,
      quantity: params.quantity,
      timestamp: Date.now(),
    };
  }

  /**
   * Cancel a standing order by its OrderId.
   */
  async cancelOrder(orderId: OrderId): Promise<void> {
    const tx = new Transaction();

    tx.moveCall({
      target: `${DEEPBOOK_PACKAGE}::pool::cancel_order`,
      arguments: [tx.object(orderId)],
    });

    await this.executeTx(tx);
  }

  /* ─── Orderbook Queries ───────────────────────────────────────────── */

  /**
   * Get the current orderbook snapshot for a pool.
   */
  async getOrderbook(poolId: PoolId): Promise<OrderbookSnapshot> {
    try {
      const poolObj = await this.client.getObject({
        id: poolId,
        options: {
          showContent: true,
          showType: true,
        },
      });

      const content = poolObj?.data?.content;
      if (!content) {
        throw new PoolNotFoundError(poolId);
      }

      const fields = (content as { fields?: Record<string, unknown> }).fields ?? {};
      const bids = this.parseOrderbookLevels(fields['bids'] as Record<string, unknown> ?? {});
      const asks = this.parseOrderbookLevels(fields['asks'] as Record<string, unknown> ?? {});

      return {
        poolId,
        bids,
        asks,
        timestamp: Date.now(),
      };
    } catch (err) {
      if (err instanceof DeepBookError) throw err;
      throw new DeepBookError(
        `Failed to fetch orderbook for pool ${poolId}`,
        'ORDERBOOK_FETCH_FAILED',
        err
      );
    }
  }

  /**
   * Get market depth (aggregated bid/ask volumes) for a pool.
   */
  async getDepth(poolId: PoolId): Promise<DepthLevel[]> {
    const orderbook = await this.getOrderbook(poolId);
    const depthMap = new Map<string, { bidVolume: bigint; askVolume: bigint }>();

    for (const bid of orderbook.bids) {
      const entry = depthMap.get(bid.price) ?? { bidVolume: 0n, askVolume: 0n };
      entry.bidVolume += BigInt(bid.quantity);
      depthMap.set(bid.price, entry);
    }

    for (const ask of orderbook.asks) {
      const entry = depthMap.get(ask.price) ?? { bidVolume: 0n, askVolume: 0n };
      entry.askVolume += BigInt(ask.quantity);
      depthMap.set(ask.price, entry);
    }

    const depthLevels: DepthLevel[] = [];
    const sortedPrices = [...depthMap.keys()].sort(
      (a, b) => Number(BigInt(a) - BigInt(b))
    );

    for (let i = 0; i < sortedPrices.length; i++) {
      const price = sortedPrices[i];
      const entry = depthMap.get(price)!;
      const nextPrice = sortedPrices[i + 1];

      depthLevels.push({
        price,
        bidVolume: entry.bidVolume.toString(),
        askVolume: entry.askVolume.toString(),
        spread: nextPrice ? (BigInt(nextPrice) - BigInt(price)).toString() : '0',
      });
    }

    return depthLevels;
  }

  /* ─── Swap / Market Order ─────────────────────────────────────────── */

  /**
   * Execute a market swap (swapExactInput) on a DeepBook pool.
   */
  async swapExactInput(
    poolId: PoolId,
    amountIn: string,
    minOut: string
  ): Promise<SwapResult> {
    const tx = new Transaction();

    const [outCoin] = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE}::pool::swap_exact_input`,
      arguments: [
        tx.object(poolId),
        tx.pure.u64(BigInt(amountIn)),
        tx.pure.u64(BigInt(minOut)),
      ],
    });

    tx.transferObjects([outCoin], tx.pure.address(this.address));

    const digest = await this.executeTx(tx);

    return {
      poolId,
      amountIn,
      amountOut: '0', // Would parse from events in production
      price: '0',
      fee: '0',
      txDigest: digest,
      timestamp: Date.now(),
    };
  }

  /* ─── Helpers ─────────────────────────────────────────────────────── */

  private parseOrderbookLevels(
    raw: Record<string, unknown>
  ): OrderbookLevel[] {
    const levels: OrderbookLevel[] = [];
    const entries = raw['entries'] ?? raw['data'] ?? [];

    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const e = entry as Record<string, unknown>;
        const fields = (e['fields'] ?? e) as Record<string, unknown>;
        levels.push({
          price: fields['price']?.toString() ?? '0',
          quantity: fields['quantity']?.toString() ?? fields['size']?.toString() ?? '0',
          total: fields['total']?.toString() ?? '0',
        });
      }
    }

    return levels;
  }
}
