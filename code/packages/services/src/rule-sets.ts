// Seeds rule set v1 (MH-03): the definition and checksum stored match the code; activation is recorded once.
import { createHash } from 'node:crypto';
import pg from 'pg';
import { RULE_SET_VERSION, RULES_V1 } from '@fixtriage/core';

export function ruleSetChecksum(): string {
  return createHash('sha256').update(JSON.stringify(RULES_V1)).digest('hex');
}

export async function seedRuleSets(ownerUrl: string): Promise<string> {
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    const checksum = ruleSetChecksum();
    const ex = await c.query('select checksum from rule_sets where version = $1', [RULE_SET_VERSION]);
    if (ex.rows[0]) {
      if (ex.rows[0].checksum !== checksum) throw new Error(`rule set v${RULE_SET_VERSION} in the database differs from the code; release a new version`);
      return `v${RULE_SET_VERSION} present`;
    }
    await c.query('insert into rule_sets (version, definition, checksum, activated_at) values ($1, $2, $3, now())', [RULE_SET_VERSION, JSON.stringify(RULES_V1), checksum]);
    return `v${RULE_SET_VERSION} inserted`;
  } finally {
    await c.end();
  }
}
