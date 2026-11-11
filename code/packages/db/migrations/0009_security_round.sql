-- Security fixes after the B2 review (verification section 8.6). Not deployed anywhere yet.
-- Item 5 (V6.5.2): recovery codes become Argon2id PHC strings with a salt per code. Existing local rows cannot be
-- converted (only their SHA-256 was kept); they are removed, and the users re-enrol to get new codes.
DELETE FROM "recovery_codes";
--> statement-breakpoint
ALTER TABLE "recovery_codes" DROP CONSTRAINT "recovery_codes_user_code_uq";--> statement-breakpoint
CREATE INDEX "recovery_codes_user_idx" ON "recovery_codes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "recovery_codes" DROP COLUMN "code_hash";--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD COLUMN "code_phc" text NOT NULL;
--> statement-breakpoint
-- Item 3: check-then-count was racy. Every limit is now one call that locks the key's row, decides and counts in the
-- same statement sequence. Time comes from the caller's clock (the application clock), so tests can move it.
DROP FUNCTION auth_throttle_check(bytea);
--> statement-breakpoint
DROP FUNCTION auth_throttle_hit(bytea, integer, integer, integer);
--> statement-breakpoint
-- Fixed window: up to p_limit attempts per p_window_s; the attempt after that locks the key for p_lock_s.
-- Returns 0 when this attempt may go ahead (and it was counted), else the seconds to wait (not counted).
CREATE FUNCTION auth_throttle_take(p_key bytea, p_now timestamptz, p_limit integer, p_window_s integer, p_lock_s integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r auth_throttle%ROWTYPE;
BEGIN
  INSERT INTO auth_throttle (key_hash, window_start, hits) VALUES (p_key, p_now, 0) ON CONFLICT (key_hash) DO NOTHING;
  SELECT * INTO r FROM auth_throttle WHERE key_hash = p_key FOR UPDATE;
  IF r.locked_until IS NOT NULL AND r.locked_until > p_now THEN
    RETURN GREATEST(1, ceil(extract(epoch FROM r.locked_until - p_now)))::int;
  END IF;
  IF r.window_start < p_now - make_interval(secs => p_window_s) THEN
    r.hits := 0;
    r.window_start := p_now;
  END IF;
  IF r.hits >= p_limit THEN
    UPDATE auth_throttle SET locked_until = p_now + make_interval(secs => p_lock_s), hits = 0, window_start = p_now WHERE key_hash = p_key;
    RETURN p_lock_s;
  END IF;
  UPDATE auth_throttle SET hits = r.hits + 1, window_start = r.window_start, locked_until = NULL WHERE key_hash = p_key;
  RETURN 0;
END $$;
--> statement-breakpoint
-- Item 4: capped back-off per sign-in identity instead of a hard lock. The first p_free attempts in the window are
-- free; each attempt from the p_free-th on sets a wait before the next one of 2^(n - p_free) seconds, at most p_cap_s.
-- An attempt during the wait is refused (not counted). A success clears the key (auth_throttle_clear).
CREATE FUNCTION auth_backoff_take(p_key bytea, p_now timestamptz, p_free integer, p_cap_s integer, p_window_s integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r auth_throttle%ROWTYPE;
BEGIN
  INSERT INTO auth_throttle (key_hash, window_start, hits) VALUES (p_key, p_now, 0) ON CONFLICT (key_hash) DO NOTHING;
  SELECT * INTO r FROM auth_throttle WHERE key_hash = p_key FOR UPDATE;
  IF r.locked_until IS NOT NULL AND r.locked_until > p_now THEN
    RETURN GREATEST(1, ceil(extract(epoch FROM r.locked_until - p_now)))::int;
  END IF;
  IF r.window_start < p_now - make_interval(secs => p_window_s) THEN
    r.hits := 0;
    r.window_start := p_now;
  END IF;
  r.hits := r.hits + 1;
  UPDATE auth_throttle SET hits = r.hits, window_start = r.window_start,
    locked_until = CASE WHEN r.hits >= p_free THEN p_now + make_interval(secs => LEAST(p_cap_s, power(2, LEAST(r.hits - p_free, 20))::int)) ELSE NULL END
  WHERE key_hash = p_key;
  RETURN 0;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION auth_throttle_take(bytea, timestamptz, integer, integer, integer), auth_backoff_take(bytea, timestamptz, integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_throttle_take(bytea, timestamptz, integer, integer, integer), auth_backoff_take(bytea, timestamptz, integer, integer, integer) TO fixtriage_app;
