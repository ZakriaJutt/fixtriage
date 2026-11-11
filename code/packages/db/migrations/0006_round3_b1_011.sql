ALTER TABLE "outbound_messages" DROP CONSTRAINT "outbound_messages_purpose_values";--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "handled_as" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_handled_as_values" CHECK ("inbound_messages"."handled_as" in ('vendor_reply'));--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_purpose_values" CHECK ("outbound_messages"."purpose" in ('safety_reply', 'urgent_prompt', 'notice', 'tenant_update', 'follow_up', 'page_sms', 'page_voice', 'dispatch', 'digest', 'test_page', 'probe'));--> statement-breakpoint
-- B1-011: /readyz stays red while a stored inbound message has neither a request nor a reason to have none
-- (carrier keyword, vendor dispatch reply). Unrouted messages never reach this table (unrouted_inbound, B1-004).
-- Platform-level health view, no IDs and no text (schema.md 4, IT-10).
CREATE VIEW inbound_health AS
  SELECT min(stored_at) AS oldest_without_request, count(*)::int AS without_request
  FROM inbound_messages WHERE request_id IS NULL AND keyword IS NULL AND handled_as IS NULL;
--> statement-breakpoint
GRANT SELECT ON inbound_health TO fixtriage_app;
