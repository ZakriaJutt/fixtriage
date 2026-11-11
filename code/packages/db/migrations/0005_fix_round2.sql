-- B1 fix round 2: operator view of dead jobs (IDs, account, kind, attempts, error class only; no payload, no text).
-- Used only by the operator routes /ops/jobs/* (role operator, audited). Listed in schema.md 4 and checked by IT-10.
CREATE VIEW dead_jobs AS SELECT id, account_id, kind, attempts, last_error, created_at FROM jobs WHERE state = 'dead';
--> statement-breakpoint
GRANT SELECT ON dead_jobs TO fixtriage_app;
