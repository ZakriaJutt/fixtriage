ALTER TABLE "jobs" DROP CONSTRAINT "jobs_state_values";--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_state_values" CHECK ("jobs"."state" in ('queued', 'done', 'dead', 'dismissed'));