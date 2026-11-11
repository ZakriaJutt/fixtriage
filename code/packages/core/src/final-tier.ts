// UR-3, UR-5: final tier = highest of rule tier, model tier and `uncertain` when uncertainty applies.
import { maxTier, tierRank, type Tier } from './tiers';

/**
 * Minimum model confidence below which the model result counts as `uncertain` (UR-3).
 * PRD 7.1 names the threshold but gives no number; 0.80 is a proposal `[P]` recorded in the B1 section
 * of verification-report-fixing.md until PRD 7.1 fixes it.
 */
export const MODEL_CONFIDENCE_THRESHOLD = 0.8;

export type ModelOutcome =
  | { status: 'ok'; tier: Tier; confidence: number }
  | { status: 'failed' | 'timeout' | 'malformed' | 'refused' };

export interface FinalTierInput {
  ruleTier: Tier | null;
  ruleUncertainty: boolean;
  model: ModelOutcome | null;
}

export interface FinalTier {
  tier: Tier;
  source: 'rule' | 'model' | 'uncertainty';
  uncertaintyReasons: string[];
}

/**
 * Strict check of a model answer (B1-001, B1-006): a known lower-case tier and a finite confidence in [0, 1].
 * Anything else is `malformed`, which ends `uncertain` (UR-3).
 */
export function validateModelAnswer(a: { tier?: unknown; confidence?: unknown } | null | undefined): ModelOutcome {
  if (!a || typeof a !== 'object') return { status: 'malformed' };
  const tier = a.tier;
  const c = a.confidence;
  if (typeof tier !== 'string' || !(['life_safety', 'urgent', 'uncertain', 'routine'] as const).includes(tier as Tier)) return { status: 'malformed' };
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) return { status: 'malformed' };
  return { status: 'ok', tier: tier as Tier, confidence: c };
}

export function finalTier(input: FinalTierInput): FinalTier {
  const reasons: string[] = [];
  if (input.ruleUncertainty) reasons.push('unusable_text');
  let modelTier: Tier | null = null;
  const m = input.model;
  if (m === null) reasons.push('no_model_result');
  else if (m.status !== 'ok') reasons.push(`model_${m.status}`);
  else if (!Number.isFinite(m.confidence) || m.confidence < 0 || m.confidence > 1) reasons.push('model_malformed');
  else if (!(m.confidence >= MODEL_CONFIDENCE_THRESHOLD)) {
    reasons.push('low_confidence');
    modelTier = m.tier === 'routine' ? null : m.tier; // a confident-enough raise still counts; a weak routine does not
  } else {
    modelTier = m.tier;
    if (input.ruleTier !== null && Math.abs(tierRank(input.ruleTier) - tierRank(m.tier)) > 1) reasons.push('rule_model_disagree');
  }
  const uncertainty: Tier | null = reasons.length > 0 ? 'uncertain' : null;
  const tier = maxTier(input.ruleTier, modelTier, uncertainty);
  let source: FinalTier['source'];
  if (input.ruleTier !== null && tier === input.ruleTier) source = 'rule';
  else if (modelTier !== null && tier === modelTier) source = 'model';
  else source = 'uncertainty';
  return { tier, source, uncertaintyReasons: reasons };
}

/** Raise-only merge used for re-evaluation (DU-2) and late model answers (TRD 6.3). */
export function raiseOnly(current: Tier, proposed: Tier): Tier {
  return tierRank(proposed) > tierRank(current) ? proposed : current;
}
