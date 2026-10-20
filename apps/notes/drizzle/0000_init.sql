CREATE SCHEMA "notes";
--> statement-breakpoint
CREATE TABLE "notes"."blocks" (
	"page_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"order" text NOT NULL,
	"node" jsonb,
	"seq" integer NOT NULL,
	CONSTRAINT "blocks_page_id_id_pk" PRIMARY KEY("page_id","id")
);
--> statement-breakpoint
CREATE TABLE "notes"."notebooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notebooks_owner_id_unique" UNIQUE("owner","id")
);
--> statement-breakpoint
CREATE TABLE "notes"."pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"notebook_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_owner_id_unique" UNIQUE("owner","id"),
	CONSTRAINT "seq_not_negative" CHECK ("notes"."pages"."seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notes"."pushes" (
	"owner" text NOT NULL,
	"key" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pushes_owner_key_pk" PRIMARY KEY("owner","key")
);
--> statement-breakpoint
CREATE TABLE "notes"."strokes" (
	"page_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"stroke" jsonb,
	"seq" integer NOT NULL,
	CONSTRAINT "strokes_page_id_id_pk" PRIMARY KEY("page_id","id")
);
--> statement-breakpoint
ALTER TABLE "notes"."blocks" ADD CONSTRAINT "blocks_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "notes"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes"."pages" ADD CONSTRAINT "pages_owner_notebook_id_notebooks_owner_id_fk" FOREIGN KEY ("owner","notebook_id") REFERENCES "notes"."notebooks"("owner","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes"."strokes" ADD CONSTRAINT "strokes_page_id_block_id_blocks_page_id_id_fk" FOREIGN KEY ("page_id","block_id") REFERENCES "notes"."blocks"("page_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_page_id_seq_index" ON "notes"."blocks" USING btree ("page_id","seq");--> statement-breakpoint
CREATE INDEX "pages_owner_notebook_id_index" ON "notes"."pages" USING btree ("owner","notebook_id");--> statement-breakpoint
CREATE INDEX "strokes_page_id_seq_index" ON "notes"."strokes" USING btree ("page_id","seq");--> statement-breakpoint
CREATE INDEX "strokes_page_id_block_id_index" ON "notes"."strokes" USING btree ("page_id","block_id");