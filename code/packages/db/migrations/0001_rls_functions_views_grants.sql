-- Objects Drizzle cannot express (schema.md 4, 6, 9). Listed in CUSTOM_OBJECTS in src/schema.ts and checked by IT-14.
-- Runs as the table owner. Resolver functions and poll views are owned by the migration role; in production that is
-- the separate `resolver` owner role of schema.md 4 (deferred, B1 runs locally as the database owner).

-- 1. Force row-level security on every account-owned table (the app role is not the owner, but FORCE also binds the owner).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','users','properties','units','tenant_contacts','vendors','vendor_trades','oncall_shifts','channels',
    'incidents','requests','outbound_messages','inbound_messages','attachments','classifications','work_orders','dispatches',
    'escalations','escalation_steps','capability_tokens','audit_events','jobs','idempotency_keys']
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- 2. No overlapping on-call range for the same account and level (schema.md 3.1).
ALTER TABLE oncall_shifts ADD CONSTRAINT oncall_shifts_no_overlap
  EXCLUDE USING gist (account_id WITH =, level WITH =, tstzrange(starts_at, ends_at) WITH &&);
--> statement-breakpoint

-- 3. Tier can be lowered only with a human classification carrying a reason in the same transaction (UR-6, schema.md 6).
CREATE FUNCTION tier_rank(t text) RETURNS int IMMUTABLE LANGUAGE sql AS $$
  SELECT CASE t WHEN 'routine' THEN 0 WHEN 'uncertain' THEN 1 WHEN 'urgent' THEN 2 WHEN 'life_safety' THEN 3 END
$$;
--> statement-breakpoint
CREATE FUNCTION requests_tier_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tier_source = 'pending' AND OLD.tier_source <> 'pending' THEN
    RAISE EXCEPTION 'tier_source cannot return to pending' USING ERRCODE = 'check_violation';
  END IF;
  -- `pending` is the undecided default (shown as uncertain); its first decision may be any tier.
  IF tier_rank(NEW.tier) < tier_rank(OLD.tier) AND OLD.tier_source <> 'pending' THEN
    IF NOT EXISTS (
      SELECT 1 FROM classifications c
      WHERE c.request_id = NEW.id AND c.kind = 'human' AND c.reason IS NOT NULL AND c.xmin = pg_current_xact_id()::xid
    ) THEN
      RAISE EXCEPTION 'UR-6: lowering a tier needs a human classification with a reason in the same transaction' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER requests_tier_guard BEFORE UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION requests_tier_guard();
--> statement-breakpoint
CREATE FUNCTION incidents_tier_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF tier_rank(NEW.tier) < tier_rank(OLD.tier) AND (NEW.state <> 'downgraded' OR NEW.downgrade_reason IS NULL OR NEW.outcome_by IS NULL) THEN
    RAISE EXCEPTION 'UR-6: an incident tier is lowered only by a recorded downgrade with a reason' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER incidents_tier_guard BEFORE UPDATE ON incidents FOR EACH ROW EXECUTE FUNCTION incidents_tier_guard();
--> statement-breakpoint

-- 4. audit_events is append-only.
CREATE FUNCTION audit_events_no_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_change BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_events_no_change();
--> statement-breakpoint

-- 5. Resolver functions: the only account-data access outside withAccount (schema.md 4). IDs and listed columns only.
CREATE FUNCTION resolve_channel(p_address text)
RETURNS TABLE (account_id uuid, channel_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.account_id, c.id FROM channels c WHERE c.address = p_address
$$;
--> statement-breakpoint
CREATE FUNCTION resolve_session(p_token_hash bytea)
RETURNS TABLE (user_id uuid, operator_id uuid, account_id uuid, role text, expires_at timestamptz, csrf_token_hash bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.user_id, s.operator_id, u.account_id, COALESCE(u.role, 'operator'), s.expires_at, s.csrf_token_hash
  FROM sessions s
  LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN operators o ON o.id = s.operator_id
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND s.last_seen_at > now() - interval '8 hours'
    AND COALESCE(u.disabled_at, o.disabled_at) IS NULL
$$;
--> statement-breakpoint
CREATE FUNCTION resolve_login(p_email text)
RETURNS TABLE (user_id uuid, operator_id uuid, account_id uuid, password_hash text, totp_secret_enc bytea, totp_confirmed_at timestamptz, totp_last_step bigint, disabled_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, NULL::uuid, u.account_id, u.password_hash, u.totp_secret_enc, u.totp_confirmed_at, u.totp_last_step, u.disabled_at
  FROM users u WHERE u.email = p_email::citext
  UNION ALL
  SELECT NULL::uuid, o.id, NULL::uuid, o.password_hash, o.totp_secret_enc, NULL::timestamptz, o.totp_last_step, o.disabled_at
  FROM operators o WHERE o.email = p_email::citext
$$;
--> statement-breakpoint
CREATE FUNCTION resolve_capability(p_token_hash bytea)
RETURNS TABLE (account_id uuid, purpose text, escalation_step_id uuid, user_id uuid, dispatch_id uuid, expires_at timestamptz, used_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.account_id, t.purpose, t.escalation_step_id, t.user_id, t.dispatch_id, t.expires_at, t.used_at
  FROM capability_tokens t WHERE t.token_hash = p_token_hash
$$;
--> statement-breakpoint
CREATE FUNCTION resolve_outbound(p_provider_message_id text)
RETURNS TABLE (account_id uuid, outbound_message_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.account_id, m.id FROM outbound_messages m WHERE m.provider_message_id = p_provider_message_id
$$;
--> statement-breakpoint

-- 6. Worker poll views: IDs, account and due time only. Owned by the migration role, so they see every account.
CREATE VIEW due_escalations AS SELECT id, account_id, next_due_at FROM escalations WHERE next_due_at IS NOT NULL;
--> statement-breakpoint
CREATE VIEW pending_outbox AS
  SELECT id, account_id, created_at, next_attempt_at FROM outbound_messages
  WHERE status = 'pending' OR (status = 'unknown' AND next_attempt_at IS NOT NULL);
--> statement-breakpoint
CREATE VIEW due_dispatches AS SELECT id, account_id, confirm_due_at FROM dispatches WHERE result IS NULL;
--> statement-breakpoint
CREATE VIEW sweep_accounts AS SELECT id, status FROM accounts;
--> statement-breakpoint
CREATE VIEW due_jobs AS SELECT id, account_id, run_at FROM jobs WHERE state = 'queued';
--> statement-breakpoint

-- 7. Grants to the application role (NOSUPERUSER NOBYPASSRLS, created by scripts/setup-role.ts).
REVOKE EXECUTE ON FUNCTION resolve_channel(text), resolve_session(bytea), resolve_login(text), resolve_capability(bytea), resolve_outbound(text) FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fixtriage_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_channel(text), resolve_session(bytea), resolve_login(text), resolve_capability(bytea), resolve_outbound(text) TO fixtriage_app;
--> statement-breakpoint
GRANT SELECT ON due_escalations, pending_outbox, due_dispatches, sweep_accounts, due_jobs TO fixtriage_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON accounts, users, properties, units, tenant_contacts, vendors, vendor_trades, oncall_shifts, channels,
  incidents, requests, outbound_messages, inbound_messages, attachments, work_orders, dispatches,
  escalations, escalation_steps, capability_tokens, jobs, idempotency_keys TO fixtriage_app;
--> statement-breakpoint
GRANT DELETE ON vendor_trades, oncall_shifts TO fixtriage_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_events, classifications TO fixtriage_app;
--> statement-breakpoint
GRANT SELECT ON operators, rule_sets TO fixtriage_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON probe_runs TO fixtriage_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON pending_status_events TO fixtriage_app;
