CREATE TABLE "notes"."ink_images" (
	"page_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"rendered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ink_images_page_id_block_id_pk" PRIMARY KEY("page_id","block_id")
);
--> statement-breakpoint
CREATE TABLE "notes"."readings" (
	"page_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"latex" text,
	"text" text NOT NULL,
	"confidence" double precision NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readings_page_id_block_id_pk" PRIMARY KEY("page_id","block_id")
);
--> statement-breakpoint
ALTER TABLE "notes"."ink_images" ADD CONSTRAINT "ink_images_page_id_block_id_blocks_page_id_id_fk" FOREIGN KEY ("page_id","block_id") REFERENCES "notes"."blocks"("page_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes"."readings" ADD CONSTRAINT "readings_page_id_block_id_blocks_page_id_id_fk" FOREIGN KEY ("page_id","block_id") REFERENCES "notes"."blocks"("page_id","id") ON DELETE cascade ON UPDATE no action;