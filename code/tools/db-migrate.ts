// Applies migrations and the rule-set seed to fixtriage_dev (or fixtriage_test with --test).
import { ownerUrl, target } from '@fixtriage/db';
import { migrate } from '@fixtriage/db/migrate';
import { seedRuleSets } from '@fixtriage/services';

const which = target();
const r = await migrate(ownerUrl(which));
const seeded = await seedRuleSets(ownerUrl(which));
console.log(`fixtriage_${which}: applied ${r.applied.length} (${r.applied.join(', ') || 'none'}), already applied ${r.skipped.length}; rule sets ${seeded}`);
