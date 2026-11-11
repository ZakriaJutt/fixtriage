CREATE TABLE "auth_throttle" (
	"key_hash" "bytea" PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "recovery_codes_user_code_uq" UNIQUE("user_id","code_hash")
);
--> statement-breakpoint
ALTER TABLE "recovery_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "capability_tokens" DROP CONSTRAINT "capability_tokens_purpose_values";--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."users"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_tokens" ADD CONSTRAINT "capability_tokens_user_target" CHECK ("capability_tokens"."purpose" not in ('invite', 'reset') or "capability_tokens"."user_id" is not null);--> statement-breakpoint
ALTER TABLE "capability_tokens" ADD CONSTRAINT "capability_tokens_purpose_values" CHECK ("capability_tokens"."purpose" in ('ack', 'vendor', 'invite', 'reset'));--> statement-breakpoint
CREATE POLICY "recovery_codes_account_isolation" ON "recovery_codes" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
-- B2 sign-in (TRD 8.1, schema.md 4). recovery_codes is account-owned: RLS forced, composite foreign key, IT-10 case.
ALTER TABLE "recovery_codes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON recovery_codes TO fixtriage_app;
--> statement-breakpoint
-- Sessions and the throttle stay without any table grant for the application role; these functions are their only
-- writers. Each is SECURITY DEFINER, owned by the migration role, with a fixed search_path.
CREATE FUNCTION auth_create_session(p_user_id uuid, p_operator_id uuid, p_token_hash bytea, p_csrf_hash bytea)
RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_expires timestamptz := now() + interval '7 days';
BEGIN
  -- Only an enabled, enrolled principal gets a session (absolute lifetime 7 days, V7.3.2).
  IF p_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND disabled_at IS NULL AND totp_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'principal not eligible for a session' USING ERRCODE = '42501';
  END IF;
  IF p_operator_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operators WHERE id = p_operator_id AND disabled_at IS NULL AND totp_secret_enc IS NOT NULL) THEN
    RAISE EXCEPTION 'principal not eligible for a session' USING ERRCODE = '42501';
  END IF;
  INSERT INTO sessions (user_id, operator_id, token_hash, csrf_token_hash, last_seen_at, expires_at)
  VALUES (p_user_id, p_operator_id, p_token_hash, p_csrf_hash, now(), v_expires);
  RETURN v_expires;
END $$;
--> statement-breakpoint
-- Inactivity timeout 8 hours (V7.3.1): resolve_session refuses a session not seen for 8 hours; this keeps an active
-- one alive (written at most once a minute).
CREATE FUNCTION auth_touch_session(p_token_hash bytea)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sessions SET last_seen_at = now()
  WHERE token_hash = p_token_hash AND revoked_at IS NULL AND expires_at > now()
    AND last_seen_at > now() - interval '8 hours' AND last_seen_at < now() - interval '1 minute'
$$;
--> statement-breakpoint
CREATE FUNCTION auth_revoke_session(p_token_hash bytea)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sessions SET revoked_at = now() WHERE token_hash = p_token_hash AND revoked_at IS NULL
$$;
--> statement-breakpoint
-- Ends every session of a user (disable, reset, re-enrolment; V7.4.2). Only for a user of the account set by
-- withAccount: called with another account's user ID it changes nothing.
CREATE FUNCTION auth_revoke_user_sessions(p_user_id uuid)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH r AS (
    UPDATE sessions s SET revoked_at = now()
    FROM users u
    WHERE s.user_id = p_user_id AND u.id = s.user_id AND s.revoked_at IS NULL
      AND u.account_id = nullif(current_setting('app.account_id', true), '')::uuid
    RETURNING 1
  ) SELECT count(*)::int FROM r
$$;
--> statement-breakpoint
-- Operators belong to no account; their TOTP step is stored here so that a code is accepted once (V6.5.1).
CREATE FUNCTION auth_operator_accept_totp(p_operator_id uuid, p_step bigint)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH r AS (
    UPDATE operators SET totp_last_step = p_step, updated_at = now()
    WHERE id = p_operator_id AND disabled_at IS NULL AND (totp_last_step IS NULL OR totp_last_step < p_step)
    RETURNING 1
  ) SELECT count(*) = 1 FROM r
$$;
--> statement-breakpoint
-- Sign-in throttle (V6.3.1): seconds until the key may try again, 0 when it may.
CREATE FUNCTION auth_throttle_check(p_key bytea)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT GREATEST(0, ceil(extract(epoch FROM locked_until - now())))::int FROM auth_throttle WHERE key_hash = p_key AND locked_until > now()), 0)
$$;
--> statement-breakpoint
-- Counts one attempt in a fixed window; at p_limit the key is locked for p_lock_s seconds. Returns the lock seconds.
CREATE FUNCTION auth_throttle_hit(p_key bytea, p_limit integer, p_window_s integer, p_lock_s integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_hits int;
BEGIN
  INSERT INTO auth_throttle AS t (key_hash, window_start, hits) VALUES (p_key, now(), 1)
  ON CONFLICT (key_hash) DO UPDATE SET
    hits = CASE WHEN t.window_start < now() - make_interval(secs => p_window_s) THEN 1 ELSE t.hits + 1 END,
    window_start = CASE WHEN t.window_start < now() - make_interval(secs => p_window_s) THEN now() ELSE t.window_start END
  RETURNING hits INTO v_hits;
  IF v_hits >= p_limit THEN
    UPDATE auth_throttle SET locked_until = now() + make_interval(secs => p_lock_s), hits = 0, window_start = now() WHERE key_hash = p_key;
    RETURN p_lock_s;
  END IF;
  RETURN 0;
END $$;
--> statement-breakpoint
CREATE FUNCTION auth_throttle_clear(p_key bytea)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM auth_throttle WHERE key_hash = p_key
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION auth_create_session(uuid, uuid, bytea, bytea), auth_touch_session(bytea), auth_revoke_session(bytea),
  auth_revoke_user_sessions(uuid), auth_operator_accept_totp(uuid, bigint), auth_throttle_check(bytea),
  auth_throttle_hit(bytea, integer, integer, integer), auth_throttle_clear(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_create_session(uuid, uuid, bytea, bytea), auth_touch_session(bytea), auth_revoke_session(bytea),
  auth_revoke_user_sessions(uuid), auth_operator_accept_totp(uuid, bigint), auth_throttle_check(bytea),
  auth_throttle_hit(bytea, integer, integer, integer), auth_throttle_clear(bytea) TO fixtriage_app;
