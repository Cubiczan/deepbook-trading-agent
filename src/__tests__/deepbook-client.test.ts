/**
 * Tests for DeepBook Client
 */
import { describe, it, expect, vi } from 'vitest';
import { DeepBookClient, PoolNotFoundError, OrderNotFoundError } from '../deepbook-client.js';

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
