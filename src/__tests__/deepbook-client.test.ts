/**
 * Tests for DeepBook Client
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DeepBookClient,
  DeepBookError,
  PoolNotFoundError,
  OrderNotFoundError,
  withTimeoutAndRetry,
} from '../deepbook-client.js';

describe('DeepBookClient', () => {
  it('should initialize with default mainnet config', () => {
    const client = new DeepBookClient();
    expect(client.client).toBeDefined();
    expect(client.address).toBeDefined();
  });

  it('should initialize without keypair for read-only mode', () => {
    const client = new DeepBookClient({ network: 'testnet' });
    expect(client.keypair).toBeUndefined();
  });

  it('should throw when executing without keypair', async () => {
    const client = new DeepBookClient();
    // Access private executeTx via any
    await expect(
      (client as unknown as { executeTx: (tx: unknown) => Promise<string> }).executeTx({})
    ).rejects.toThrow('Keypair required');
  });

  it('should throw PoolNotFoundError for non-existent pool', async () => {
    const client = new DeepBookClient();
    const fakePoolId = '0xdeadbeef00000000000000000000000000000001';
    await expect(client.getOrderbook(fakePoolId)).rejects.toThrow(PoolNotFoundError);
  });
});

describe('withTimeoutAndRetry (RPC resilience)', () => {
  it('retries transient failures up to maxAttempts then succeeds', async () => {
    const op = vi
      .fn<[], Promise<string>>()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockRejectedValueOnce(new Error('502 bad gateway'))
      .mockResolvedValueOnce('ok');

    const result = await withTimeoutAndRetry(op, 'flaky-rpc', {
      maxAttempts: 3,
      backoffBaseMs: 1, // keep the test fast; real default is 1000ms
    });

    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('exhausts retries and throws RPC_RETRY_EXHAUSTED on persistent failure', async () => {
    const op = vi
      .fn<[], Promise<string>>()
      .mockRejectedValue(new Error('connection reset'));

    await expect(
      withTimeoutAndRetry(op, 'down-rpc', { maxAttempts: 3, backoffBaseMs: 1 })
    ).rejects.toMatchObject({ code: 'RPC_RETRY_EXHAUSTED' });
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('fails fast (no retry) on non-retryable errors', async () => {
    const op = vi
      .fn<[], Promise<string>>()
      .mockRejectedValue(new Error('invalid object id'));

    await expect(
      withTimeoutAndRetry(op, 'bad-input', { maxAttempts: 3, backoffBaseMs: 1 })
    ).rejects.toThrow('invalid object id');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('enforces a hard per-attempt timeout via Promise.race', async () => {
    const op = vi.fn<[], Promise<string>>(
      () => new Promise((resolve) => setTimeout(() => resolve('late'), 1_000))
    );

    await expect(
      withTimeoutAndRetry(op, 'slow-rpc', {
        timeoutMs: 10,
        maxAttempts: 1,
        backoffBaseMs: 1,
      })
    ).rejects.toBeInstanceOf(DeepBookError);
  });
});
