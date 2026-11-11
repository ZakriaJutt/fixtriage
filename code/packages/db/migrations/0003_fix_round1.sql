-- B1 fix round 1 (review fixtriage-b1-round1.md). Hand-written objects; listed in CUSTOM_OBJECTS and checked by IT-14.

-- B1-004: channel addresses resolve case-insensitively (matches the unique index on lower(address)).
CREATE OR REPLACE FUNCTION resolve_channel(p_address text)
RETURNS TABLE (account_id uuid, channel_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.account_id, c.id FROM channels c WHERE lower(c.address) = lower(btrim(p_address))
$$;
--> statement-breakpoint

-- B1-002: the job poll exposes the kind so that model calls run in their own runner, never in the loop that sends
-- safety replies and pages. Column added at the end (CREATE OR REPLACE VIEW keeps the existing columns).
CREATE OR REPLACE VIEW due_jobs AS SELECT id, account_id, run_at, kind FROM jobs WHERE state = 'queued';
--> statement-breakpoint

-- B1-001: requests that are undecided or uncertain and have no incident yet, with the time at which the
-- deterministic sweep must act: a `pending` request 30 s after receipt (decision deadline), an after-hours
-- uncertain or cannot-text request at once, a business-hours one at 15 min (EP-8). Independent of the classify job.
CREATE VIEW due_undecided AS
  SELECT r.id, r.account_id,
    CASE WHEN r.tier_source = 'pending' THEN r.opened_at + interval '30 seconds'
         WHEN r.after_hours THEN r.opened_at
         ELSE r.opened_at + interval '15 minutes' END AS due_at
  FROM requests r
  WHERE r.incident_id IS NULL AND r.state <> 'closed'
    AND (r.tier_source = 'pending' OR r.tier = 'uncertain' OR r.cannot_text)
    AND NOT EXISTS (SELECT 1 FROM classifications c WHERE c.request_id = r.id AND c.kind = 'human');
--> statement-breakpoint

-- B1-001: dead jobs are visible to /readyz (counts only, no IDs of other accounts' rows).
CREATE VIEW job_health AS
  SELECT count(*) FILTER (WHERE state = 'dead')::int AS dead_jobs FROM jobs;
--> statement-breakpoint

-- B1-009: an account's time zone and business hours are validated on write, so the T1 transaction cannot fail on them.
CREATE FUNCTION accounts_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d text; iv jsonb;
BEGIN
  PERFORM now() AT TIME ZONE NEW.timezone; -- raises for an unknown zone
  IF jsonb_typeof(NEW.business_hours) <> 'object' THEN
    RAISE EXCEPTION 'business_hours must be an object' USING ERRCODE = 'check_violation';
  END IF;
  FOR d IN SELECT jsonb_object_keys(NEW.business_hours) LOOP
    IF d NOT IN ('mon','tue','wed','thu','fri','sat','sun') OR jsonb_typeof(NEW.business_hours -> d) <> 'array' THEN
      RAISE EXCEPTION 'business_hours: bad day %', d USING ERRCODE = 'check_violation';
    END IF;
    FOR iv IN SELECT jsonb_array_elements(NEW.business_hours -> d) LOOP
      IF jsonb_typeof(iv) <> 'array' OR jsonb_array_length(iv) <> 2
         OR NOT (iv ->> 0 ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
         OR NOT (iv ->> 1 ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$')
         OR iv ->> 0 >= iv ->> 1 THEN
        RAISE EXCEPTION 'business_hours: bad interval on %', d USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounts_validate BEFORE INSERT OR UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION accounts_validate();
--> statement-breakpoint

GRANT SELECT ON due_undecided, job_health, due_jobs TO fixtriage_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON unrouted_inbound TO fixtriage_app;
