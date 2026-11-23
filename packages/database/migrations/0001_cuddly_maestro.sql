ALTER TABLE "audit_logs" ALTER COLUMN "occurred_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "integration_logs" ALTER COLUMN "occurred_at" SET DEFAULT clock_timestamp();