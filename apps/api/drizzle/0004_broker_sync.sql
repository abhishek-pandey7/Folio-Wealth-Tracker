CREATE TYPE "public"."broker_id" AS ENUM('dhan', 'zerodha', 'upstox', 'angelone', 'indmoney');--> statement-breakpoint
CREATE TABLE "broker_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"broker" "broker_id" NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"broker_user_name" text,
	"access_token" text,
	"token_expires_at" timestamp with time zone,
	"refresh" text,
	"synced_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broker_connections_portfolio_id_unique" UNIQUE("portfolio_id")
);
--> statement-breakpoint
CREATE TABLE "broker_holdings" (
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"avg_cost" numeric(20, 4) NOT NULL,
	"last_price" numeric(20, 4),
	CONSTRAINT "broker_holdings_portfolio_id_instrument_id_pk" PRIMARY KEY("portfolio_id","instrument_id")
);
--> statement-breakpoint
ALTER TABLE "broker_connections" ADD CONSTRAINT "broker_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_connections" ADD CONSTRAINT "broker_connections_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_holdings" ADD CONSTRAINT "broker_holdings_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_holdings" ADD CONSTRAINT "broker_holdings_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broker_connections_user_broker_idx" ON "broker_connections" USING btree ("user_id","broker");