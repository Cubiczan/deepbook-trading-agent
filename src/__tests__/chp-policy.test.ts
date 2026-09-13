/**
 * Tests for CHP policy path confinement (src/chp/policy.ts).
 *
 * The loader must resolve user-supplied paths and refuse anything that
 * escapes the process working directory (relative `..` or absolute).
 * Legitimate in-tree paths, including those that contain `..` but resolve
 * back inside the tree, still load.
 */
import { mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  confineToBase,
  defaultPolicy,
  defaultPolicyBase,
  defaultPolicyPath,
  loadPolicy,
} from '../chp/policy.js';

describe('confineToBase', () => {
  const base = defaultPolicyBase();

  it('accepts the default in-tree policy path', () => {
    expect(confineToBase(defaultPolicyPath(), base)).toBe(resolve(base, 'config', 'policy.yaml'));
  });

  it('accepts a relative in-tree path and a same-tree .. segment', () => {
    expect(confineToBase('config/policy.yaml', base)).toBe(resolve(base, 'config', 'policy.yaml'));
    expect(confineToBase('config/../config/policy.yaml', base)).toBe(
      resolve(base, 'config', 'policy.yaml'),
    );
  });

  it('rejects relative traversal, absolute escape, and NUL bytes', () => {
    expect(confineToBase('../../etc/passwd', base)).toBeUndefined();
    expect(confineToBase('/etc/passwd', base)).toBeUndefined();
    expect(confineToBase(resolve(base, '..', 'outside.yaml'), base)).toBeUndefined();
    expect(confineToBase('config/policy.yaml\0/etc/passwd', base)).toBeUndefined();
  });
});

describe('loadPolicy', () => {
  it('loads the in-tree config/policy.yaml via the default path', () => {
    const policy = loadPolicy();
    expect(policy.version).toBe('1.0');
    expect(policy.maxNotionalUsd).toBe(50000);
  });

  it('loads a relative in-tree path and a same-tree .. segment', () => {
    expect(loadPolicy('config/policy.yaml').version).toBe('1.0');
    expect(loadPolicy('config/../config/policy.yaml').version).toBe('1.0');
  });

  it('falls back to the conservative default when the path escapes cwd', () => {
    const expected = defaultPolicy();
    expect(loadPolicy('../../etc/passwd')).toEqual(expected);
    expect(loadPolicy('/etc/passwd')).toEqual(expected);
    expect(loadPolicy(resolve(process.cwd(), '..', 'outside.yaml'))).toEqual(expected);
  });

  it('falls back when a symlink inside the tree points outside cwd', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'chp-policy-'));
    const outsideFile = join(outsideDir, 'escape.yaml');
    writeFileSync(outsideFile, 'version: "escaped"\nmax_notional_usd: 1\n');
    const linkPath = join(process.cwd(), 'config', `.policy-escape-${Date.now()}.yaml`);
    symlinkSync(outsideFile, linkPath);
    try {
      expect(loadPolicy(linkPath)).toEqual(defaultPolicy());
    } finally {
      unlinkSync(linkPath);
    }
  });
});
