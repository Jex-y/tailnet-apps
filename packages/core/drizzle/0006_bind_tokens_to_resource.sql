ALTER TABLE "connector"."codes" ADD COLUMN "resource" text DEFAULT '/mcp' NOT NULL;--> statement-breakpoint
ALTER TABLE "connector"."tokens" ADD COLUMN "resource" text DEFAULT '/mcp' NOT NULL;