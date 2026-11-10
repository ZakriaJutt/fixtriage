// Brings fixtriage_test up to the latest migration before the suite (the clean-database run uses db:reset-test first).
import { migrate, ownerUrl } from '@fixtriage/db';
import { seedRuleSets } from '@fixtriage/services';

export default async function setup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  await migrate(ownerUrl('test'));
  await seedRuleSets(ownerUrl('test'));
}
