CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"licence_number" text,
	"timezone" text DEFAULT 'America/Vancouver' NOT NULL,
	"business_hours" jsonb NOT NULL,
	"holidays" date[] DEFAULT '{}'::date[] NOT NULL,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"gas_emergency_phone" text DEFAULT '+18006639911' NOT NULL,
	"ack_timeout_seconds" integer DEFAULT 300 NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"plan" text NOT NULL,
	"door_count" integer,
	"retention_months" integer DEFAULT 24 NOT NULL,
	CONSTRAINT "accounts_ack_timeout_range" CHECK ("accounts"."ack_timeout_seconds" between 180 and 600),
	CONSTRAINT "accounts_retention_range" CHECK ("accounts"."retention_months" between 12 and 36),
	CONSTRAINT "accounts_status_values" CHECK ("accounts"."status" in ('onboarding', 'live', 'paused', 'closed')),
	CONSTRAINT "accounts_plan_values" CHECK ("accounts"."plan" in ('pilot', 'starter', 'pro', 'business')),
	CONSTRAINT "accounts_emergency_phone_e164" CHECK ("accounts"."emergency_contact_phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "accounts_gas_phone_e164" CHECK ("accounts"."gas_emergency_phone" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"idx" smallint NOT NULL,
	"storage_key" text,
	"content_type" text,
	"bytes" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"description_ai" text,
	CONSTRAINT "attachments_message_idx_uq" UNIQUE("inbound_message_id","idx"),
	CONSTRAINT "attachments_status_values" CHECK ("attachments"."status" in ('pending', 'stored', 'unavailable', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"correlation_id" uuid NOT NULL,
	CONSTRAINT "audit_events_actor_values" CHECK ("audit_events"."actor_kind" in ('user', 'operator', 'system', 'tenant', 'vendor', 'provider'))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "capability_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"escalation_step_id" uuid,
	"user_id" uuid,
	"dispatch_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "capability_tokens_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "capability_tokens_purpose_values" CHECK ("capability_tokens"."purpose" in ('ack', 'vendor')),
	CONSTRAINT "capability_tokens_ack_targets" CHECK ("capability_tokens"."purpose" <> 'ack' or ("capability_tokens"."escalation_step_id" is not null and "capability_tokens"."user_id" is not null)),
	CONSTRAINT "capability_tokens_vendor_target" CHECK ("capability_tokens"."purpose" <> 'vendor' or "capability_tokens"."dispatch_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "capability_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"address" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_inbound_at" timestamp with time zone,
	CONSTRAINT "channels_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "channels_kind_values" CHECK ("channels"."kind" in ('sms', 'email'))
);
--> statement-breakpoint
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"inbound_message_id" uuid,
	"kind" text NOT NULL,
	"rule_set_version" integer,
	"matched_rule" text,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"proposed_tier" text,
	"proposed_trade" text,
	"proposed_unit_id" uuid,
	"confidence" numeric(4, 3),
	"missing_fields" text[],
	"status" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	CONSTRAINT "classifications_kind_values" CHECK ("classifications"."kind" in ('rule', 'model', 'human')),
	CONSTRAINT "classifications_status_values" CHECK ("classifications"."status" in ('ok', 'failed', 'timeout', 'late')),
	CONSTRAINT "classifications_tier_values" CHECK ("classifications"."proposed_tier" in ('life_safety', 'urgent', 'uncertain', 'routine')),
	CONSTRAINT "classifications_human_actor" CHECK ("classifications"."kind" <> 'human' or "classifications"."actor_user_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "classifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"vendor_id" uuid,
	"free_text_recipient" text,
	"seq" smallint NOT NULL,
	"emergency" boolean NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"confirm_due_at" timestamp with time zone NOT NULL,
	"result" text,
	"result_at" timestamp with time zone,
	CONSTRAINT "dispatches_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "dispatches_work_order_seq_uq" UNIQUE("work_order_id","seq"),
	CONSTRAINT "dispatches_result_values" CHECK ("dispatches"."result" in ('confirmed', 'declined', 'timeout', 'undelivered', 'phoned'))
);
--> statement-breakpoint
ALTER TABLE "dispatches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "escalation_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"escalation_id" uuid NOT NULL,
	"cycle" integer NOT NULL,
	"level" smallint NOT NULL,
	"attempt" smallint NOT NULL,
	"target_role" text NOT NULL,
	"target_user_id" uuid,
	"target_operator_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"result" text,
	CONSTRAINT "escalation_steps_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "escalation_steps_key_uq" UNIQUE("escalation_id","cycle","level","attempt","target_role"),
	CONSTRAINT "escalation_steps_level_values" CHECK ("escalation_steps"."level" in (1, 2, 3, 4)),
	CONSTRAINT "escalation_steps_role_values" CHECK ("escalation_steps"."target_role" in ('oncall', 'previous_acknowledger', 'approver', 'operator_primary', 'operator_backup')),
	CONSTRAINT "escalation_steps_level4_operator" CHECK (("escalation_steps"."level" = 4) = ("escalation_steps"."target_operator_id" is not null or "escalation_steps"."target_role" in ('operator_primary', 'operator_backup'))),
	CONSTRAINT "escalation_steps_result_values" CHECK ("escalation_steps"."result" in ('acknowledged', 'operator_engaged', 'timeout', 'delivery_failed', 'superseded', 'no_target'))
);
--> statement-breakpoint
ALTER TABLE "escalation_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"dispatch_id" uuid,
	"request_id" uuid,
	"state" text DEFAULT 'paging' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"current_level" smallint DEFAULT 1 NOT NULL,
	"cycle" integer DEFAULT 1 NOT NULL,
	"next_due_at" timestamp with time zone,
	"companions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"operator_engaged_by" uuid,
	"operator_engaged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"acknowledged_via" text,
	"relayed_by_operator_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"tenant_notice_sent_at" timestamp with time zone,
	"outcome_reminder_sent_at" timestamp with time zone,
	"policy_version" integer NOT NULL,
	CONSTRAINT "escalations_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "escalations_trigger_values" CHECK ("escalations"."trigger" in ('new_incident', 'uncertain_timeout', 'no_outcome', 'dispatch_failed', 'new_unit_report')),
	CONSTRAINT "escalations_dispatch_trigger" CHECK ("escalations"."trigger" <> 'dispatch_failed' or "escalations"."dispatch_id" is not null),
	CONSTRAINT "escalations_state_values" CHECK ("escalations"."state" in ('paging', 'acknowledged')),
	CONSTRAINT "escalations_ack_via_values" CHECK ("escalations"."acknowledged_via" in ('voice', 'link', 'app', 'operator_relay')),
	CONSTRAINT "escalations_relay_pair" CHECK (("escalations"."acknowledged_via" = 'operator_relay') = ("escalations"."relayed_by_operator_id" is not null)),
	CONSTRAINT "escalations_ack_person" CHECK ("escalations"."state" <> 'acknowledged' or "escalations"."acknowledged_by" is not null)
);
--> statement-breakpoint
ALTER TABLE "escalations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"key" text NOT NULL,
	"route" text NOT NULL,
	"response_status" smallint NOT NULL,
	"response_body" jsonb NOT NULL,
	CONSTRAINT "idempotency_keys_account_key_uq" UNIQUE("account_id","key","route")
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"from_address" text NOT NULL,
	"body" text,
	"media_count" smallint DEFAULT 0 NOT NULL,
	"keyword" text,
	"received_at" timestamp with time zone NOT NULL,
	"stored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid,
	"tenant_contact_id" uuid,
	"correlation_id" uuid NOT NULL,
	"raw_payload" jsonb,
	"safety_reply_id" uuid,
	CONSTRAINT "inbound_messages_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "inbound_messages_keyword_values" CHECK ("inbound_messages"."keyword" in ('stop', 'start', 'help'))
);
--> statement-breakpoint
ALTER TABLE "inbound_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"property_id" uuid,
	"hazard_class" text NOT NULL,
	"tier" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"building_wide" boolean DEFAULT false NOT NULL,
	"building_wide_set_by" uuid,
	"outcome" text,
	"outcome_by" uuid,
	"outcome_at" timestamp with time zone,
	"downgrade_reason" text,
	CONSTRAINT "incidents_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "incidents_tier_values" CHECK ("incidents"."tier" in ('life_safety', 'urgent', 'uncertain', 'routine')),
	CONSTRAINT "incidents_state_values" CHECK ("incidents"."state" in ('open', 'acknowledged', 'outcome_recorded', 'downgraded', 'closed')),
	CONSTRAINT "incidents_outcome_values" CHECK ("incidents"."outcome" in ('vendor_dispatched', 'handled_by_phone', 'attending', 'downgraded')),
	CONSTRAINT "incidents_building_wide_by" CHECK (not "incidents"."building_wide" or "incidents"."building_wide_set_by" is not null),
	CONSTRAINT "incidents_downgrade_reason" CHECK ("incidents"."state" <> 'downgraded' or "incidents"."downgrade_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "incidents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"correlation_id" uuid NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_account_dedupe_uq" UNIQUE("account_id","dedupe_key"),
	CONSTRAINT "jobs_kind_values" CHECK ("jobs"."kind" in ('intake.process', 'classify', 'triage.timeout')),
	CONSTRAINT "jobs_state_values" CHECK ("jobs"."state" in ('queued', 'done', 'dead'))
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "oncall_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"recurrence" text,
	"last_test_page_at" timestamp with time zone,
	"last_test_page_ok" boolean,
	CONSTRAINT "oncall_shifts_level_values" CHECK ("oncall_shifts"."level" in (1, 2, 3)),
	CONSTRAINT "oncall_shifts_range" CHECK ("oncall_shifts"."ends_at" > "oncall_shifts"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "oncall_shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text NOT NULL,
	"mobile" text NOT NULL,
	"level4_rank" smallint NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" "bytea",
	"totp_last_step" bigint,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "operators_email_uq" UNIQUE("email"),
	CONSTRAINT "operators_rank_values" CHECK ("operators"."level4_rank" in (1, 2)),
	CONSTRAINT "operators_mobile_e164" CHECK ("operators"."mobile" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"to_address" text NOT NULL,
	"channel" text NOT NULL,
	"template_id" text,
	"template_version" integer,
	"body" text NOT NULL,
	"body_sha256" "bytea" NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_rank" smallint DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"escalation_step_id" uuid,
	"dispatch_id" uuid,
	"request_id" uuid,
	"correlation_id" uuid NOT NULL,
	"approved_by" uuid,
	CONSTRAINT "outbound_messages_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "outbound_messages_account_dedupe_uq" UNIQUE("account_id","dedupe_key"),
	CONSTRAINT "outbound_messages_purpose_values" CHECK ("outbound_messages"."purpose" in ('safety_reply', 'notice', 'tenant_update', 'follow_up', 'page_sms', 'page_voice', 'dispatch', 'digest', 'test_page', 'probe')),
	CONSTRAINT "outbound_messages_channel_values" CHECK ("outbound_messages"."channel" in ('sms', 'voice', 'email')),
	CONSTRAINT "outbound_messages_status_values" CHECK ("outbound_messages"."status" in ('pending', 'sending', 'sent', 'delivered', 'undelivered', 'failed', 'unknown')),
	CONSTRAINT "outbound_messages_dispatch_approved" CHECK ("outbound_messages"."purpose" <> 'dispatch' or "outbound_messages"."approved_by" is not null)
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pending_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"status" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pending_status_events_status_values" CHECK ("pending_status_events"."status" in ('sent', 'delivered', 'undelivered', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "probe_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone,
	"ok" boolean,
	CONSTRAINT "probe_runs_kind_values" CHECK ("probe_runs"."kind" in ('sms_round_trip', 'email_inbound'))
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"label" text NOT NULL,
	"street_address" text NOT NULL,
	"city" text NOT NULL,
	"emergency_contact_phone" text,
	"gas_emergency_phone" text,
	CONSTRAINT "properties_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "properties_account_street_uq" UNIQUE("account_id","street_address"),
	CONSTRAINT "properties_emergency_phone_e164" CHECK ("properties"."emergency_contact_phone" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "properties_gas_phone_e164" CHECK ("properties"."gas_emergency_phone" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"unit_id" uuid,
	"incident_id" uuid,
	"incident_link_state" text,
	"cannot_text" boolean DEFAULT false NOT NULL,
	"trade" text,
	"tier" text DEFAULT 'uncertain' NOT NULL,
	"tier_source" text NOT NULL,
	"after_hours" boolean NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "requests_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "requests_link_state_values" CHECK ("requests"."incident_link_state" in ('own', 'suggested', 'confirmed', 'rejected')),
	CONSTRAINT "requests_link_state_pair" CHECK (("requests"."incident_id" is null) = ("requests"."incident_link_state" is null)),
	CONSTRAINT "requests_trade_values" CHECK ("requests"."trade" in ('plumbing', 'heating', 'electrical', 'locksmith', 'appliance', 'restoration', 'general', 'other')),
	CONSTRAINT "requests_tier_values" CHECK ("requests"."tier" in ('life_safety', 'urgent', 'uncertain', 'routine')),
	CONSTRAINT "requests_tier_source_values" CHECK ("requests"."tier_source" in ('pending', 'rule', 'model', 'uncertainty', 'human')),
	CONSTRAINT "requests_pending_is_uncertain" CHECK ("requests"."tier_source" <> 'pending' or "requests"."tier" = 'uncertain'),
	CONSTRAINT "requests_state_values" CHECK ("requests"."state" in ('open', 'awaiting_tenant', 'awaiting_approval', 'dispatched', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"activated_at" timestamp with time zone,
	"checksum" text NOT NULL,
	CONSTRAINT "rule_sets_version_uq" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"operator_id" uuid,
	"csrf_token_hash" "bytea" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "sessions_one_principal" CHECK (num_nonnulls("sessions"."user_id", "sessions"."operator_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "tenant_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text,
	"mobile" text,
	"email" "citext",
	"sms_opted_out_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tenant_contacts_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "tenant_contacts_reachable" CHECK ("tenant_contacts"."mobile" is not null or "tenant_contacts"."email" is not null),
	CONSTRAINT "tenant_contacts_mobile_e164" CHECK ("tenant_contacts"."mobile" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "tenant_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "units_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "units_account_property_label_uq" UNIQUE("account_id","property_id","label")
);
--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text NOT NULL,
	"mobile" text,
	"role" text NOT NULL,
	"is_reviewer" boolean DEFAULT false NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" "bytea",
	"totp_confirmed_at" timestamp with time zone,
	"totp_last_step" bigint,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "users_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "users_role_values" CHECK ("users"."role" in ('owner', 'manager')),
	CONSTRAINT "users_mobile_e164" CHECK ("users"."mobile" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendor_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"trade" text NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "vendor_trades_account_trade_rank_uq" UNIQUE("account_id","trade","rank"),
	CONSTRAINT "vendor_trades_vendor_trade_uq" UNIQUE("vendor_id","trade"),
	CONSTRAINT "vendor_trades_trade_values" CHECK ("vendor_trades"."trade" in ('plumbing', 'heating', 'electrical', 'locksmith', 'appliance', 'restoration', 'general', 'other'))
);
--> statement-breakpoint
ALTER TABLE "vendor_trades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mobile" text,
	"email" "citext",
	"after_hours" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "vendors_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "vendors_mobile_e164" CHECK ("vendors"."mobile" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"request_id" uuid,
	"incident_id" uuid,
	"unit_id" uuid,
	"trade" text NOT NULL,
	"tier" text NOT NULL,
	"summary" text NOT NULL,
	"access_notes" text,
	"state" text DEFAULT 'draft' NOT NULL,
	CONSTRAINT "work_orders_account_id_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "work_orders_trade_values" CHECK ("work_orders"."trade" in ('plumbing', 'heating', 'electrical', 'locksmith', 'appliance', 'restoration', 'general', 'other')),
	CONSTRAINT "work_orders_tier_values" CHECK ("work_orders"."tier" in ('life_safety', 'urgent', 'uncertain', 'routine')),
	CONSTRAINT "work_orders_state_values" CHECK ("work_orders"."state" in ('draft', 'approved', 'sent', 'confirmed', 'no_response', 'closed')),
	CONSTRAINT "work_orders_has_parent" CHECK ("work_orders"."request_id" is not null or "work_orders"."incident_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "work_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_inbound_fk" FOREIGN KEY ("account_id","inbound_message_id") REFERENCES "public"."inbound_messages"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_tokens" ADD CONSTRAINT "capability_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_tokens" ADD CONSTRAINT "capability_tokens_step_fk" FOREIGN KEY ("account_id","escalation_step_id") REFERENCES "public"."escalation_steps"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_tokens" ADD CONSTRAINT "capability_tokens_user_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."users"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_tokens" ADD CONSTRAINT "capability_tokens_dispatch_fk" FOREIGN KEY ("account_id","dispatch_id") REFERENCES "public"."dispatches"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_rule_set_version_rule_sets_version_fk" FOREIGN KEY ("rule_set_version") REFERENCES "public"."rule_sets"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_request_fk" FOREIGN KEY ("account_id","request_id") REFERENCES "public"."requests"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_actor_fk" FOREIGN KEY ("account_id","actor_user_id") REFERENCES "public"."users"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_work_order_fk" FOREIGN KEY ("account_id","work_order_id") REFERENCES "public"."work_orders"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_vendor_fk" FOREIGN KEY ("account_id","vendor_id") REFERENCES "public"."vendors"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_approved_by_fk" FOREIGN KEY ("account_id","approved_by") REFERENCES "public"."users"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_steps" ADD CONSTRAINT "escalation_steps_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_steps" ADD CONSTRAINT "escalation_steps_target_operator_id_operators_id_fk" FOREIGN KEY ("target_operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_steps" ADD CONSTRAINT "escalation_steps_escalation_fk" FOREIGN KEY ("account_id","escalation_id") REFERENCES "public"."escalations"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_steps" ADD CONSTRAINT "escalation_steps_user_fk" FOREIGN KEY ("account_id","target_user_id") REFERENCES "public"."users"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_operator_engaged_by_operators_id_fk" FOREIGN KEY ("operator_engaged_by") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_relayed_by_operator_id_operators_id_fk" FOREIGN KEY ("relayed_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_incident_fk" FOREIGN KEY ("account_id","incident_id") REFERENCES "public"."incidents"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_dispatch_fk" FOREIGN KEY ("account_id","dispatch_id") REFERENCES "public"."dispatches"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_request_fk" FOREIGN KEY ("account_id","request_id") REFERENCES "public"."requests"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_acknowledged_by_fk" FOREIGN KEY ("account_id","acknowledged_by") REFERENCES "public"."users"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_channel_fk" FOREIGN KEY ("account_id","channel_id") REFERENCES "public"."channels"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_request_fk" FOREIGN KEY ("account_id","request_id") REFERENCES "public"."requests"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_tenant_contact_fk" FOREIGN KEY ("account_id","tenant_contact_id") REFERENCES "public"."tenant_contacts"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_safety_reply_fk" FOREIGN KEY ("account_id","safety_reply_id") REFERENCES "public"."outbound_messages"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_property_fk" FOREIGN KEY ("account_id","property_id") REFERENCES "public"."properties"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_building_wide_by_fk" FOREIGN KEY ("account_id","building_wide_set_by") REFERENCES "public"."users"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_outcome_by_fk" FOREIGN KEY ("account_id","outcome_by") REFERENCES "public"."users"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oncall_shifts" ADD CONSTRAINT "oncall_shifts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oncall_shifts" ADD CONSTRAINT "oncall_shifts_user_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."users"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_approved_by_fk" FOREIGN KEY ("account_id","approved_by") REFERENCES "public"."users"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_unit_fk" FOREIGN KEY ("account_id","unit_id") REFERENCES "public"."units"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_incident_fk" FOREIGN KEY ("account_id","incident_id") REFERENCES "public"."incidents"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_contacts" ADD CONSTRAINT "tenant_contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_contacts" ADD CONSTRAINT "tenant_contacts_unit_fk" FOREIGN KEY ("account_id","unit_id") REFERENCES "public"."units"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_property_fk" FOREIGN KEY ("account_id","property_id") REFERENCES "public"."properties"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_trades" ADD CONSTRAINT "vendor_trades_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_trades" ADD CONSTRAINT "vendor_trades_vendor_fk" FOREIGN KEY ("account_id","vendor_id") REFERENCES "public"."vendors"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_request_fk" FOREIGN KEY ("account_id","request_id") REFERENCES "public"."requests"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_incident_fk" FOREIGN KEY ("account_id","incident_id") REFERENCES "public"."incidents"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_unit_fk" FOREIGN KEY ("account_id","unit_id") REFERENCES "public"."units"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_object_idx" ON "audit_events" USING btree ("account_id","object_type","object_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_address_uq" ON "channels" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "classifications_model_once_uq" ON "classifications" USING btree ("inbound_message_id","model") WHERE kind = 'model';--> statement-breakpoint
CREATE INDEX "classifications_request_idx" ON "classifications" USING btree ("account_id","request_id","created_at");--> statement-breakpoint
CREATE INDEX "dispatches_due_idx" ON "dispatches" USING btree ("confirm_due_at") WHERE result is null;--> statement-breakpoint
CREATE UNIQUE INDEX "escalations_dispatch_uq" ON "escalations" USING btree ("dispatch_id") WHERE dispatch_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "escalations_one_paging_uq" ON "escalations" USING btree ("incident_id") WHERE state = 'paging';--> statement-breakpoint
CREATE INDEX "escalations_due_idx" ON "escalations" USING btree ("next_due_at") WHERE next_due_at is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_messages_provider_id_uq" ON "inbound_messages" USING btree ("provider","provider_message_id");--> statement-breakpoint
CREATE INDEX "inbound_messages_sender_idx" ON "inbound_messages" USING btree ("account_id","from_address","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "incidents_duplicate_lookup_idx" ON "incidents" USING btree ("account_id","property_id","hazard_class","created_at" DESC NULLS LAST) WHERE state in ('open', 'acknowledged');--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("run_at") WHERE state = 'queued';--> statement-breakpoint
CREATE INDEX "oncall_shifts_lookup_idx" ON "oncall_shifts" USING btree ("account_id","level","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operators_active_rank_uq" ON "operators" USING btree ("level4_rank") WHERE disabled_at is null;--> statement-breakpoint
CREATE INDEX "outbound_messages_poll_idx" ON "outbound_messages" USING btree ("status","created_at") WHERE status in ('pending', 'unknown');--> statement-breakpoint
CREATE INDEX "outbound_messages_provider_id_idx" ON "outbound_messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "outbound_messages_to_purpose_idx" ON "outbound_messages" USING btree ("account_id","to_address","purpose","created_at");--> statement-breakpoint
CREATE INDEX "pending_status_events_provider_id_idx" ON "pending_status_events" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "requests_inbox_idx" ON "requests" USING btree ("account_id","state","tier","opened_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "requests_incident_idx" ON "requests" USING btree ("account_id","incident_id","incident_link_state");--> statement-breakpoint
CREATE INDEX "requests_after_hours_idx" ON "requests" USING btree ("account_id","after_hours","opened_at");--> statement-breakpoint
CREATE INDEX "tenant_contacts_account_mobile_idx" ON "tenant_contacts" USING btree ("account_id","mobile");--> statement-breakpoint
CREATE INDEX "tenant_contacts_account_email_idx" ON "tenant_contacts" USING btree ("account_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_one_reviewer_uq" ON "users" USING btree ("account_id") WHERE is_reviewer;--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_account_mobile_uq" ON "vendors" USING btree ("account_id","mobile") WHERE mobile is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_incident_uq" ON "work_orders" USING btree ("incident_id") WHERE incident_id is not null;--> statement-breakpoint
CREATE POLICY "accounts_account_isolation" ON "accounts" AS PERMISSIVE FOR ALL TO public USING (id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "attachments_account_isolation" ON "attachments" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "audit_events_account_isolation" ON "audit_events" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "capability_tokens_account_isolation" ON "capability_tokens" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "channels_account_isolation" ON "channels" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "classifications_account_isolation" ON "classifications" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "dispatches_account_isolation" ON "dispatches" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "escalation_steps_account_isolation" ON "escalation_steps" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "escalations_account_isolation" ON "escalations" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "idempotency_keys_account_isolation" ON "idempotency_keys" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "inbound_messages_account_isolation" ON "inbound_messages" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "incidents_account_isolation" ON "incidents" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "jobs_account_isolation" ON "jobs" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "oncall_shifts_account_isolation" ON "oncall_shifts" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbound_messages_account_isolation" ON "outbound_messages" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "properties_account_isolation" ON "properties" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "requests_account_isolation" ON "requests" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_contacts_account_isolation" ON "tenant_contacts" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "units_account_isolation" ON "units" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "users_account_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "vendor_trades_account_isolation" ON "vendor_trades" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "vendors_account_isolation" ON "vendors" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "work_orders_account_isolation" ON "work_orders" AS PERMISSIVE FOR ALL TO public USING (account_id = nullif(current_setting('app.account_id', true), '')::uuid) WITH CHECK (account_id = nullif(current_setting('app.account_id', true), '')::uuid);