/**
 * deepbook-trading-agent — CHP Risk Policy loader
 *
 * Mirrors the donor `cm-policy` / `sfe-policy` YAML policy engine: load a flat
 * policy YAML, fall back to a conservative default if the file is missing or
 * unparseable. No external YAML dependency is added — the policy schema is flat
 * (scalars + a simple string list + a numeric map), so a tiny purpose-built
 * parser keeps the change additive and dependency-free.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type ChpAction =
  | 'swap'
  | 'market_make'
  | 'arbitrage'
  | 'hedge'
  | 'liquidity_provision';

export interface RiskPolicy {
  version: string;
  /** Hard ceiling per single action (quote-asset notional). Above => BLOCK. */
  maxNotionalUsd: number;
  /** Rolling daily cumulative notional cap. */
  dailyNotionalCapUsd: number;
  /** HITL threshold. At/above => human approval required. */
  hitlThresholdUsd: number;
  /** Actions the agent may take at all. */
  allowedActions: ChpAction[];
  /** Per-pool notional caps keyed by poolId. */
  perAssetLimits: Record<string, number>;
  /** Minimum decision confidence (0..1). */
  minConfidence: number;
}

/** Conservative built-in fallback used when the policy file is absent. */
export function defaultPolicy(): RiskPolicy {
  return {
    version: '1.0-default',
    maxNotionalUsd: 10000.0,
    dailyNotionalCapUsd: 50000.0,
    hitlThresholdUsd: 5000.0,
    allowedActions: ['swap', 'market_make', 'arbitrage', 'hedge', 'liquidity_provision'],
    perAssetLimits: {},
    minConfidence: 0.5,
  };
}

/** Default location of the policy file (config/policy.yaml under cwd). */
export function defaultPolicyPath(): string {
  return resolve(process.cwd(), 'config', 'policy.yaml');
}

/**
 * Load a risk policy from a flat YAML file. Returns a conservative default (and
 * logs a warning) if the file is missing or cannot be parsed — non-breaking.
 */
export function loadPolicy(policyPath: string = defaultPolicyPath()): RiskPolicy {
  if (!existsSync(policyPath)) {
    console.warn(
      `[CHP] policy file not found at ${policyPath} — using conservative default policy`,
    );
    return defaultPolicy();
  }
  try {
    const raw = readFileSync(policyPath, 'utf8');
    return coercePolicy(parseFlatYaml(raw));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[CHP] failed to parse policy ${policyPath} (${msg}) — using default policy`);
    return defaultPolicy();
  }
}

/* ─── Minimal flat-YAML parser ──────────────────────────────────────────────
 * Supports `key: value` scalars, a top-level `key:` followed by indented
 * `- item` list entries, and a top-level `key:` followed by indented
 * `subkey: value` numeric maps (or inline `{}`). Comments and blanks ignored.
 * Covers the policy schema exactly; anything richer falls to the default.
 */
type YamlValue = string | number | boolean | string[] | Record<string, number>;

function parseFlatYaml(text: string): Record<string, YamlValue> {
  const out: Record<string, YamlValue> = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = stripComment(lines[i]);
    if (line.trim() === '') { i++; continue; }
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) { i++; continue; }
    const key = m[1];
    const inline = m[2].trim();
    if (inline !== '' && inline !== '{}') {
      out[key] = parseScalar(inline);
      i++;
      continue;
    }
    if (inline === '{}') {
      out[key] = {};
      i++;
      continue;
    }
    const list: string[] = [];
    const map: Record<string, number> = {};
    let j = i + 1;
    while (j < lines.length && /^\s+\S/.test(lines[j])) {
      const t = stripComment(lines[j]).trim();
      j++;
      if (t === '') continue;
      if (t.startsWith('- ')) {
        list.push(stripQuotes(t.slice(2).trim()));
      } else {
        const cm = /^(.+?):\s*(.*)$/.exec(t);
        if (cm) map[stripQuotes(cm[1].trim())] = Number(cm[2].trim());
      }
    }
    out[key] = list.length > 0 ? list : map;
    i = j;
  }
  return out;
}

function stripComment(line: string): string {
  const idx = line.indexOf('#');
  return idx === -1 ? line : line.slice(0, idx);
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, '');
}

function parseScalar(s: string): string | number | boolean {
  const v = stripQuotes(s);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

function coercePolicy(p: Record<string, YamlValue>): RiskPolicy {
  const d = defaultPolicy();
  const num = (k: string, fallback: number): number =>
    typeof p[k] === 'number' ? (p[k] as number) : fallback;
  const actions = Array.isArray(p['allowed_actions'])
    ? (p['allowed_actions'] as string[]).map((a) => a as ChpAction)
    : d.allowedActions;
  const perAsset = p['per_asset_limits'] && !Array.isArray(p['per_asset_limits'])
    ? (p['per_asset_limits'] as Record<string, number>)
    : {};
  return {
    version: typeof p['version'] === 'string' ? (p['version'] as string) : d.version,
    maxNotionalUsd: num('max_notional_usd', d.maxNotionalUsd),
    dailyNotionalCapUsd: num('daily_notional_cap_usd', d.dailyNotionalCapUsd),
    hitlThresholdUsd: num('hitl_threshold_usd', d.hitlThresholdUsd),
    allowedActions: actions,
    perAssetLimits: perAsset,
    minConfidence: num('min_confidence', d.minConfidence),
  };
}
