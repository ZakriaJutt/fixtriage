// Brings fixtriage_test up to the latest migration before the suite (the clean-database run uses db:reset-test first).
import { ownerUrl } from '@fixtriage/db';
import { migrate } from '@fixtriage/db/migrate';
import { seedRuleSets } from '@fixtriage/services';

export default async function setup(): Promise<void> {
  (process.env as Record<string, string>).NODE_ENV = 'test';
  await migrate(ownerUrl('test'));
  await seedRuleSets(ownerUrl('test'));
}
