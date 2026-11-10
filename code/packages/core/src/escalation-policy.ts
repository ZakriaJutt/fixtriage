// Escalation policy v1 (PRD 7.2 EP-3..EP-8, EP-11; FD-3, FD-4; DU-2, DU-3 windows). Pure: times are numbers (ms).
// The numbers below are the PRD's; the PRD is canonical and these constants cite it.

export const ESCALATION_POLICY_VERSION = 1;

export const EP = {
  /** EP-3: default acknowledgement timeout per level; the account may set 180-600 s (schema accounts.ack_timeout_seconds). */
  defaultAckTimeoutSeconds: 300,
  /** EP-3: second attempt at 2 minutes. */
  secondAttemptSeconds: 120,
  /** EP-5: backup operator 5 minutes after the primary (20 vs 15 min). */
  operatorBackupDelaySeconds: 300,
  /** EP-5: both operators re-paged every 5 minutes until one responds. */
  operatorRepageSeconds: 300,
  /** EP-5: Levels 1-3 re-paged every 15 minutes regardless, from 15 minutes after Level 4 starts (30 min). */
  levelRepageSeconds: 900,
  /** EP-6: tenant notice at 15 minutes without acknowledgement. */
  tenantNoticeSeconds: 900,
  /** EP-7: outcome reminder at 30 minutes after acknowledgement. */
  outcomeReminderSeconds: 1800,
  /** EP-11a: reopen when no outcome 45 minutes after acknowledgement. */
  outcomeReopenSeconds: 2700,
  /** EP-8: business-hours `uncertain` pages Level 1 if not triaged in 15 minutes. */
  uncertainTriageSeconds: 900,
  /** FD-3: emergency dispatch confirmation within 10 minutes. */
  emergencyConfirmSeconds: 600,
  /** FD-4: routine dispatch confirmation within 4 business hours. */
  routineConfirmBusinessMinutes: 240,
  /** MH-02: no second safety reply to the same sender within 30 minutes unless a UR-1/UR-2 rule hit. */
  safetyReplyWindowSeconds: 1800,
  /** DU-2: same sender, open request, within 30 minutes. */
  sameSenderWindowSeconds: 1800,
  /** DU-3: different senders, same property and hazard class, within 6 hours. */
  duplicateWindowSeconds: 6 * 3600,
} as const;

export type TargetRole = 'oncall' | 'previous_acknowledger' | 'approver' | 'operator_primary' | 'operator_backup';
export type CompanionRole = Extract<TargetRole, 'previous_acknowledger' | 'approver'>;

export interface StepKey {
  cycle: number;
  level: 1 | 2 | 3 | 4;
  attempt: number;
  role: TargetRole;
}
export interface PlannedStep extends StepKey {
  dueAt: number;
}

export interface PlanInput {
  startedAt: number;
  ackTimeoutSeconds: number;
  existing: PlannedStep[];
  operatorEngagedAt: number | null;
  /** EP-11 / FD-3: people paged together with Level 1 (attempts 1 and 2 of cycle 1). */
  companions: CompanionRole[];
  now: number;
}

export interface PlanOutput {
  /** Steps whose due time has passed and that do not exist yet: create all of them, none is skipped (IT-06). */
  due: PlannedStep[];
  /** Earliest future planned step, or null if none (never null while paging: operators or Levels 1-3 re-pages remain). */
  nextDueAt: number | null;
}

export const keyOf = (k: StepKey): string => `${k.cycle}:${k.level}:${k.attempt}:${k.role}`;

/** Level start times of cycle 1, honouring an early start recorded by EP-4. */
export function levelStarts(input: Pick<PlanInput, 'startedAt' | 'ackTimeoutSeconds' | 'existing'>): [number, number, number, number] {
  const T = input.ackTimeoutSeconds * 1000;
  const first = (level: number, role: TargetRole) => input.existing.find((s) => s.cycle === 1 && s.level === level && s.attempt === 1 && s.role === role)?.dueAt;
  const s1 = input.startedAt;
  const s2 = first(2, 'oncall') ?? s1 + T;
  const s3 = first(3, 'oncall') ?? s2 + T;
  const s4 = first(4, 'operator_primary') ?? s3 + T;
  return [s1, s2, s3, s4];
}

export function planSteps(input: PlanInput): PlanOutput {
  const second = EP.secondAttemptSeconds * 1000;
  const [s1, s2, s3, s4] = levelStarts(input);
  const starts = [s1, s2, s3, s4];
  const planned: PlannedStep[] = [];
  let future: number | null = null;
  const consider = (p: PlannedStep) => {
    if (p.dueAt <= input.now) planned.push(p);
    else if (future === null || p.dueAt < future) future = p.dueAt;
  };

  // Cycle 1, Levels 1-3: attempt 1 at level start, attempt 2 two minutes later unless the next level has started.
  for (let lv = 1; lv <= 3; lv++) {
    const start = starts[lv - 1]!;
    const nextStart = starts[lv]!;
    const roles: TargetRole[] = lv === 1 ? ['oncall', ...input.companions] : ['oncall'];
    for (const role of roles) {
      consider({ cycle: 1, level: lv as 1 | 2 | 3, attempt: 1, role, dueAt: start });
      if (start + second < nextStart) consider({ cycle: 1, level: lv as 1 | 2 | 3, attempt: 2, role, dueAt: start + second });
    }
  }

  // Level 4 (EP-5): primary at s4, backup 5 min later, then both every 5 min until an operator engages.
  const engaged = input.operatorEngagedAt;
  const opOpen = (t: number) => engaged === null || t <= engaged;
  const rep = EP.operatorRepageSeconds * 1000;
  const backupAt = s4 + EP.operatorBackupDelaySeconds * 1000;
  if (opOpen(s4)) consider({ cycle: 1, level: 4, attempt: 1, role: 'operator_primary', dueAt: s4 });
  if (opOpen(backupAt)) consider({ cycle: 1, level: 4, attempt: 1, role: 'operator_backup', dueAt: backupAt });
  for (let k = 2; ; k++) {
    const t = backupAt + (k - 1) * rep;
    if (!opOpen(t)) break;
    consider({ cycle: 1, level: 4, attempt: k, role: 'operator_primary', dueAt: t });
    consider({ cycle: 1, level: 4, attempt: k, role: 'operator_backup', dueAt: t });
    if (t > input.now) break;
  }

  // Levels 1-3 re-paged together every 15 minutes from s4 + 15 min, whether or not an operator engaged.
  const lrep = EP.levelRepageSeconds * 1000;
  for (let cycle = 2; ; cycle++) {
    const t = s4 + (cycle - 1) * lrep;
    for (const lv of [1, 2, 3] as const) consider({ cycle, level: lv, attempt: 1, role: 'oncall', dueAt: t });
    if (t > input.now) break;
  }

  const have = new Set(input.existing.map(keyOf));
  const due = planned.filter((p) => !have.has(keyOf(p))).sort((a, b) => a.dueAt - b.dueAt || a.level - b.level);
  return { due, nextDueAt: future };
}
