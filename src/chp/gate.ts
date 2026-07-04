/**
 * deepbook-trading-agent — CHP Decision Gate
 *
 * Port of the CleanMandate / SwarmFi-Executor CHP gate:
 *   - loads a risk policy (config/policy.yaml, conservative default fallback)
 *   - drives a proposed action through decision states
 *       EXPLORING -> PROVISIONAL -> LOCKED (or BLOCKED / HITL_REQUIRED)
 *   - runs a lightweight adversarial / sanity check
 *   - records per-decision provenance (an append-only in-memory ledger)
 *   - BLOCKS or requires HITL approval when notional exceeds a threshold
 *
 * Capital-moving decisions must pass gate.evaluate(action) before submission.
 */

import { createHash, randomUUID } from 'node:crypto';
import { loadPolicy, defaultPolicyPath, type RiskPolicy, type ChpAction } from './policy.js';

export type { ChpAction } from './policy.js';
export type { RiskPolicy } from './policy.js';

/** Lifecycle states a proposed action moves through. */
export type ChpState =
  | 'EXPLORING'
  | 'PROVISIONAL'
  | 'LOCKED'
  | 'HITL_REQUIRED'
  | 'BLOCKED';

/** A capital-moving action proposed to the gate. */
export interface ProposedAction {
  /** DeepBook trading action (swap, market_make, ...). */
  action: ChpAction;
  /** Pool the action targets (used for per-pool caps + provenance). */
  poolId: string;
  /** Notional value of the action in the quote asset. */
  notionalUsd: number;
  /** Decision confidence 0..1 (adversarial input). */
  confidence?: number;
  /** Free-form rationale carried into provenance. */
  rationale?: string;
}

export interface Provenance {
  decisionId: string;
  timestamp: string;
  action: ProposedAction;
  state: ChpState;
  contentHash: string;
  claims: { rule: string; passed: boolean; detail: string }[];
}

export interface ChpDecision {
  allowed: boolean;
  requiresHuman: boolean;
  state: ChpState;
  reason: string;
  provenance: Provenance;
}

export class ChpGate {
  private policy: RiskPolicy;
  private ledger: Provenance[] = [];
  private dailyNotionalUsd = 0;
  private dailyWindowStart = Date.now();

  constructor(policy?: RiskPolicy, policyPath: string = defaultPolicyPath()) {
    this.policy = policy ?? loadPolicy(policyPath);
  }

  getPolicy(): RiskPolicy {
    return this.policy;
  }

  /** Append-only provenance ledger (per-decision records). */
  getLedger(): readonly Provenance[] {
    return this.ledger;
  }

  /**
   * Evaluate a proposed capital-moving action.
   *
   * States: EXPLORING (received) -> run policy + adversarial checks.
   *   - any hard violation          => BLOCKED  (allowed=false)
   *   - notional >= hitl_threshold  => HITL_REQUIRED (allowed=false, requiresHuman)
   *   - otherwise                   => PROVISIONAL -> LOCKED (allowed=true)
   */
  evaluate(proposed: ProposedAction): ChpDecision {
    const claims: Provenance['claims'] = [];
    const add = (rule: string, passed: boolean, detail: string) =>
      claims.push({ rule, passed, detail });

    // ── Policy checks (hard blocks) ──────────────────────────
    const actionAllowed = this.policy.allowedActions.includes(proposed.action);
    add('allowed-action', actionAllowed, `action ${proposed.action}`);

    const poolCap = this.policy.perAssetLimits[proposed.poolId];
    const effectiveCap = poolCap ?? this.policy.maxNotionalUsd;
    const underPoolCap = proposed.notionalUsd <= effectiveCap;
    add('per-pool-cap', underPoolCap, `${proposed.poolId} notional ${proposed.notionalUsd} vs cap ${effectiveCap}`);

    const underMax = proposed.notionalUsd <= this.policy.maxNotionalUsd;
    add('max-notional', underMax, `${proposed.notionalUsd} vs max ${this.policy.maxNotionalUsd}`);

    this.rollDailyWindow();
    const projectedDaily = this.dailyNotionalUsd + proposed.notionalUsd;
    const underDaily = projectedDaily <= this.policy.dailyNotionalCapUsd;
    add('daily-cap', underDaily, `projected ${projectedDaily} vs daily cap ${this.policy.dailyNotionalCapUsd}`);

    const sane = this.adversarialCheck(proposed, add);

    const hardOk = actionAllowed && underPoolCap && underMax && underDaily && sane;
    if (!hardOk) {
      const failed = claims.filter((c) => !c.passed).map((c) => c.rule);
      return this.finalize(proposed, 'BLOCKED', claims, false, false, `blocked: ${failed.join(', ')}`);
    }

    // Passed hard checks -> PROVISIONAL, then HITL / LOCK.
    const requiresHuman = proposed.notionalUsd >= this.policy.hitlThresholdUsd;
    if (requiresHuman) {
      return this.finalize(
        proposed,
        'HITL_REQUIRED',
        claims,
        false,
        true,
        `human approval required: ${proposed.notionalUsd} >= HITL threshold ${this.policy.hitlThresholdUsd}`,
      );
    }

    this.dailyNotionalUsd = projectedDaily;
    return this.finalize(proposed, 'LOCKED', claims, true, false, 'auto-approved under CHP thresholds');
  }

  /**
   * Register an explicit human approval for a HITL-gated action, promoting it
   * to LOCKED. Mirrors the donor `principal_approve`.
   */
  approveHuman(proposed: ProposedAction, approver: string): ChpDecision {
    this.rollDailyWindow();
    const projectedDaily = this.dailyNotionalUsd + proposed.notionalUsd;
    if (projectedDaily > this.policy.dailyNotionalCapUsd || proposed.notionalUsd > this.policy.maxNotionalUsd) {
      return this.finalize(
        proposed,
        'BLOCKED',
        [{ rule: 'post-approval-recheck', passed: false, detail: 'exceeds hard caps even with approval' }],
        false,
        false,
        'human approval rejected: exceeds hard caps',
      );
    }
    this.dailyNotionalUsd = projectedDaily;
    return this.finalize(
      proposed,
      'LOCKED',
      [{ rule: 'human-approval', passed: true, detail: `approved by ${approver}` }],
      true,
      false,
      `human-approved by ${approver}`,
    );
  }

  // ── Internals ──────────────────────────────────────────────

  private adversarialCheck(
    proposed: ProposedAction,
    add: (rule: string, passed: boolean, detail: string) => void,
  ): boolean {
    let ok = true;

    // A notional of exactly 0 means "unsized" — the strategy applies its own
    // defaults/caps downstream, so it is allowed through. Negative / NaN /
    // Infinity notionals are always rejected.
    const saneNotional = Number.isFinite(proposed.notionalUsd) && proposed.notionalUsd >= 0;
    add('sane-notional', saneNotional, `notional=${proposed.notionalUsd}`);
    if (!saneNotional) ok = false;

    if (proposed.confidence !== undefined) {
      const confidentEnough = proposed.confidence >= this.policy.minConfidence;
      add('min-confidence', confidentEnough, `confidence ${proposed.confidence} vs min ${this.policy.minConfidence}`);
      if (!confidentEnough) ok = false;
    }

    return ok;
  }

  private rollDailyWindow(): void {
    const DAY_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - this.dailyWindowStart >= DAY_MS) {
      this.dailyWindowStart = Date.now();
      this.dailyNotionalUsd = 0;
    }
  }

  private finalize(
    action: ProposedAction,
    state: ChpState,
    claims: Provenance['claims'],
    allowed: boolean,
    requiresHuman: boolean,
    reason: string,
  ): ChpDecision {
    const timestamp = new Date().toISOString();
    const canonical = JSON.stringify({ action, state, claims, timestamp });
    const contentHash = createHash('sha256').update(canonical).digest('hex');
    const provenance: Provenance = {
      decisionId: randomUUID(),
      timestamp,
      action,
      state,
      contentHash,
      claims,
    };
    this.ledger.push(provenance);
    return { allowed, requiresHuman, state, reason, provenance };
  }
}
