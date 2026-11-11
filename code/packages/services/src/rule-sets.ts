// Seeds rule sets (MH-03): each version's definition and checksum stored match the code; a stored version is
// never rewritten. v1 is kept for decisions made with it; the current version is the one evaluateRules uses.
import { createHash } from 'node:crypto';
import pg from 'pg';
import { RULE_SET_VERSION, RULES_V1, RULES_V2 } from '@fixtriage/core';

const DEFINITIONS: Record<number, unknown> = { 1: RULES_V1, 2: { normaliser: 2, rules: RULES_V2 } };

export function ruleSetChecksum(version: number = RULE_SET_VERSION): string {
  return createHash('sha256').update(JSON.stringify(DEFINITIONS[version])).digest('hex');
}

export async function seedRuleSets(ownerUrl: string): Promise<string> {
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  const done: string[] = [];
  try {
    for (const [v, def] of Object.entries(DEFINITIONS)) {
      const version = Number(v);
      const checksum = ruleSetChecksum(version);
      const ex = await c.query('select checksum from rule_sets where version = $1', [version]);
      if (ex.rows[0]) {
        if (ex.rows[0].checksum !== checksum) throw new Error(`rule set v${version} in the database differs from the code; release a new version`);
        done.push(`v${version} present`);
        continue;
      }
      await c.query('insert into rule_sets (version, definition, checksum, activated_at) values ($1, $2, $3, $4)', [version, JSON.stringify(def), checksum, version === RULE_SET_VERSION ? new Date() : null]);
      done.push(`v${version} inserted`);
    }
    return done.join(', ');
  } finally {
    await c.end();
  }
}
