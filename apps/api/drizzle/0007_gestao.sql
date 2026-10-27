CREATE TABLE "booking_extra_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"service_name" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_extra_items_quantity_check" CHECK ("booking_extra_items"."quantity" > 0),
	CONSTRAINT "booking_extra_items_unit_check" CHECK ("booking_extra_items"."unit" in ('hour','project'))
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"recurrence_parent_id" uuid,
	"attachment_key" text,
	"attachment_name" text,
	"attachment_content_type" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "expenses_amount_check" CHECK ("expenses"."amount_cents" > 0),
	CONSTRAINT "expenses_recurrence_check" CHECK ("expenses"."recurrence" in ('none','monthly','quarterly','yearly'))
);
--> statement-breakpoint
CREATE TABLE "extra_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reference_price_cents" integer,
	"unit" text NOT NULL,
	"sale_mode" text DEFAULT 'quote' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extra_services_unit_check" CHECK ("extra_services"."unit" in ('hour','project')),
	CONSTRAINT "extra_services_sale_mode_check" CHECK ("extra_services"."sale_mode" in ('quote','online')),
	CONSTRAINT "extra_services_status_check" CHECK ("extra_services"."status" in ('active','inactive')),
	CONSTRAINT "extra_services_price_check" CHECK ("extra_services"."reference_price_cents" is null or "extra_services"."reference_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ics_feed_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"user_id" uuid,
	"room_id" uuid,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	CONSTRAINT "ics_feed_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "ics_feed_tokens_scope_check" CHECK ("ics_feed_tokens"."scope" in ('user','clinic','room')),
	CONSTRAINT "ics_feed_tokens_user_check" CHECK (("ics_feed_tokens"."scope" = 'user') = ("ics_feed_tokens"."user_id" is not null)),
	CONSTRAINT "ics_feed_tokens_room_check" CHECK (("ics_feed_tokens"."scope" = 'room') = ("ics_feed_tokens"."room_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "manual_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"revenue_category" text NOT NULL,
	"method" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text,
	"user_id" uuid,
	"booking_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "manual_receipts_revenue_category_check" CHECK ("manual_receipts"."revenue_category" in ('rental_single','subscription_initial','subscription_renewal','extra_hours','extra_services','other')),
	CONSTRAINT "manual_receipts_method_check" CHECK ("manual_receipts"."method" in ('cash','card_machine','pix_direct')),
	CONSTRAINT "manual_receipts_amount_check" CHECK ("manual_receipts"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "mcp_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "mcp_tokens_scope_check" CHECK ("mcp_tokens"."scope" in ('read','read_write'))
);
--> statement-breakpoint
CREATE TABLE "notification_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_recipients_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"user_id" uuid,
	"booking_id" uuid,
	"name" text NOT NULL,
	"email" text,
	"phone" text NOT NULL,
	"description" text NOT NULL,
	"desired_on" date,
	"status" text DEFAULT 'new' NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"staff_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_requests_status_check" CHECK ("quote_requests"."status" in ('new','contacted','quote_sent','won','lost')),
	CONSTRAINT "quote_requests_source_check" CHECK ("quote_requests"."source" in ('web','app','admin'))
);
--> statement-breakpoint
ALTER TABLE "booking_extra_items" ADD CONSTRAINT "booking_extra_items_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_extra_items" ADD CONSTRAINT "booking_extra_items_service_id_extra_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."extra_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurrence_parent_id_expenses_id_fk" FOREIGN KEY ("recurrence_parent_id") REFERENCES "public"."expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ics_feed_tokens" ADD CONSTRAINT "ics_feed_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ics_feed_tokens" ADD CONSTRAINT "ics_feed_tokens_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ics_feed_tokens" ADD CONSTRAINT "ics_feed_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_receipts" ADD CONSTRAINT "manual_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_receipts" ADD CONSTRAINT "manual_receipts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_receipts" ADD CONSTRAINT "manual_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_service_id_extra_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."extra_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_extra_items_booking_idx" ON "booking_extra_items" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_name_uq" ON "expense_categories" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_recurrence_child_uq" ON "expenses" USING btree ("recurrence_parent_id","date") WHERE "expenses"."recurrence_parent_id" is not null and "expenses"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "expenses_recurring_parent_idx" ON "expenses" USING btree ("recurrence") WHERE "expenses"."recurrence" <> 'none' and "expenses"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ics_feed_tokens_user_active_uq" ON "ics_feed_tokens" USING btree ("user_id") WHERE "ics_feed_tokens"."scope" = 'user' and "ics_feed_tokens"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ics_feed_tokens_shared_active_uq" ON "ics_feed_tokens" USING btree ("scope",coalesce("room_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "ics_feed_tokens"."scope" in ('clinic','room') and "ics_feed_tokens"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "manual_receipts_date_idx" ON "manual_receipts" USING btree ("date");--> statement-breakpoint
CREATE INDEX "mcp_tokens_owner_active_idx" ON "mcp_tokens" USING btree ("owner_user_id") WHERE "mcp_tokens"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "quote_requests_status_created_idx" ON "quote_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "quote_requests_user_idx" ON "quote_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "charges_approved_at_idx" ON "charges" USING btree ("approved_at") WHERE "charges"."approved_at" is not null;