CREATE TABLE "unrouted_inbound" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"to_address" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by_operator_id" uuid,
	CONSTRAINT "unrouted_inbound_kind_values" CHECK ("unrouted_inbound"."kind" in ('sms', 'email'))
);
--> statement-breakpoint
DROP INDEX "channels_address_uq";--> statement-breakpoint
ALTER TABLE "unrouted_inbound" ADD CONSTRAINT "unrouted_inbound_cleared_by_operator_id_operators_id_fk" FOREIGN KEY ("cleared_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unrouted_inbound_provider_id_uq" ON "unrouted_inbound" USING btree ("provider","provider_message_id");--> statement-breakpoint
CREATE INDEX "unrouted_inbound_open_idx" ON "unrouted_inbound" USING btree ("received_at") WHERE cleared_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_address_lower_uq" ON "channels" USING btree (lower("address"));