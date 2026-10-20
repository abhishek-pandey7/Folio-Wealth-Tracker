CREATE TABLE "fund_data" (
	"scheme_code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"fund_house" text,
	"category_id" text,
	"nav_date" date,
	"seen_at" timestamp with time zone,
	"stats" jsonb,
	"stats_at" timestamp with time zone,
	"error" text,
	"error_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_state" (
	"name" text PRIMARY KEY NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"report" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbol_data" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text,
	"exchange" text,
	"currency" "currency",
	"stats" jsonb,
	"stats_at" timestamp with time zone,
	"quote" jsonb,
	"quote_at" timestamp with time zone,
	"error" text,
	"error_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "fund_data_category_idx" ON "fund_data" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "fund_data_stats_at_idx" ON "fund_data" USING btree ("stats_at");--> statement-breakpoint
CREATE INDEX "symbol_data_stats_at_idx" ON "symbol_data" USING btree ("stats_at");--> statement-breakpoint
CREATE INDEX "symbol_data_quote_at_idx" ON "symbol_data" USING btree ("quote_at");