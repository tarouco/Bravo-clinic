CREATE TABLE "booking_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"weekdays" smallint[] DEFAULT '{1,2,3,4,5,6,7}'::smallint[] NOT NULL,
	"applies_on_holidays" boolean DEFAULT true NOT NULL,
	"start_minute" smallint DEFAULT 0 NOT NULL,
	"end_minute" smallint DEFAULT 1440 NOT NULL,
	"weekday_rate_cents" integer,
	"weekend_rate_cents" integer,
	"min_duration_minutes" integer,
	"fixed_price_cents" integer,
	"price_per_occurrence_cents" integer,
	"included_minutes" integer,
	"period" text NOT NULL,
	"is_reference" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"room_id" uuid,
	"display_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_categories_type_check" CHECK ("booking_categories"."type" in ('hourly','block','hour_package','fixed_schedule')),
	CONSTRAINT "booking_categories_period_check" CHECK ("booking_categories"."period" in ('single','monthly','bimonthly','quarterly')),
	CONSTRAINT "booking_categories_status_check" CHECK ("booking_categories"."status" in ('active','inactive')),
	CONSTRAINT "booking_categories_visibility_check" CHECK ("booking_categories"."visibility" in ('public','admin_only')),
	CONSTRAINT "booking_categories_hourly_check" CHECK ("booking_categories"."type" <> 'hourly' or ("booking_categories"."weekday_rate_cents" is not null and "booking_categories"."weekend_rate_cents" is not null and "booking_categories"."min_duration_minutes" is not null and "booking_categories"."period" = 'single')),
	CONSTRAINT "booking_categories_block_check" CHECK ("booking_categories"."type" <> 'block' or ("booking_categories"."fixed_price_cents" is not null and "booking_categories"."period" = 'single')),
	CONSTRAINT "booking_categories_hour_package_check" CHECK ("booking_categories"."type" <> 'hour_package' or ("booking_categories"."fixed_price_cents" is not null and "booking_categories"."included_minutes" > 0 and "booking_categories"."period" <> 'single')),
	CONSTRAINT "booking_categories_fixed_schedule_check" CHECK ("booking_categories"."type" <> 'fixed_schedule' or ("booking_categories"."price_per_occurrence_cents" is not null and "booking_categories"."period" <> 'single')),
	CONSTRAINT "booking_categories_reference_hourly_check" CHECK (not "booking_categories"."is_reference" or "booking_categories"."type" = 'hourly')
);
--> statement-breakpoint
CREATE TABLE "booking_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "booking_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"booking_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"origin" text NOT NULL,
	"reason" text,
	"data" jsonb,
	CONSTRAINT "booking_events_origin_check" CHECK ("booking_events"."origin" in ('web','app','admin','mcp','job','system'))
);
--> statement-breakpoint
CREATE TABLE "booking_reschedule_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"new_room_id" uuid NOT NULL,
	"new_starts_at" timestamp with time zone NOT NULL,
	"new_ends_at" timestamp with time zone NOT NULL,
	"quote" jsonb NOT NULL,
	"pay_now_cents" integer NOT NULL,
	"charge_id" uuid,
	"hold_block_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "booking_reschedule_requests_pay_now_check" CHECK ("booking_reschedule_requests"."pay_now_cents" > 0),
	CONSTRAINT "booking_reschedule_requests_status_check" CHECK ("booking_reschedule_requests"."status" in ('pending','applied','expired','cancelled','refunded'))
);
--> statement-breakpoint
CREATE TABLE "booking_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"category_id" uuid,
	"category_name" text NOT NULL,
	"day_type" text NOT NULL,
	"rate_cents_per_hour" integer,
	"minutes" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "booking_segments_booking_seq_uq" UNIQUE("booking_id","seq"),
	CONSTRAINT "booking_segments_day_type_check" CHECK ("booking_segments"."day_type" in ('weekday','weekend_holiday'))
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"kind" text DEFAULT 'single' NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"created_by_user_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"cleanup_minutes" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"payment_mode" text NOT NULL,
	"gross_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"discount_source" text DEFAULT 'none' NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"credit_applied_cents" integer DEFAULT 0 NOT NULL,
	"balance_charge_at" timestamp with time zone,
	"balance_due_at" timestamp with time zone,
	"hold_expires_at" timestamp with time zone,
	"policy_snapshot" jsonb NOT NULL,
	"reschedule_count" integer DEFAULT 0 NOT NULL,
	"checked_in_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"confirmed_manually_by" uuid,
	"ics_uid" text NOT NULL,
	"ics_sequence" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"payment_link_token_hash" text,
	"cleanup_overridden_by" uuid,
	"cleanup_overridden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_code_unique" UNIQUE("code"),
	CONSTRAINT "bookings_ics_uid_unique" UNIQUE("ics_uid"),
	CONSTRAINT "bookings_kind_check" CHECK ("bookings"."kind" in ('single','fixed_occurrence')),
	CONSTRAINT "bookings_status_check" CHECK ("bookings"."status" in ('awaiting_payment','pre_reserved','held_for_renewal','confirmed','paid','completed','no_show','expired','cancelled_by_tenant','cancelled_nonpayment','cancelled_by_clinic')),
	CONSTRAINT "bookings_source_check" CHECK ("bookings"."source" in ('web','app','admin','mcp')),
	CONSTRAINT "bookings_payment_mode_check" CHECK ("bookings"."payment_mode" in ('deposit_balance','full_upfront','package','subscription','manual')),
	CONSTRAINT "bookings_discount_source_check" CHECK ("bookings"."discount_source" in ('none','coupon','slot_discount')),
	CONSTRAINT "bookings_period_check" CHECK ("bookings"."ends_at" > "bookings"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"purpose" text NOT NULL,
	"method" text NOT NULL,
	"user_id" uuid NOT NULL,
	"booking_id" uuid,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"pix_qr_code" text,
	"pix_copy_paste" text,
	"checkout_url" text,
	"expires_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"raw_last" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charges_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "charges_amount_check" CHECK ("charges"."amount_cents" > 0),
	CONSTRAINT "charges_purpose_check" CHECK ("charges"."purpose" in ('booking_deposit','booking_balance','booking_full','booking_difference','subscription_initial','subscription_renewal','extra_hours','extra_service')),
	CONSTRAINT "charges_method_check" CHECK ("charges"."method" in ('pix','card','saved_card','credit')),
	CONSTRAINT "charges_status_check" CHECK ("charges"."status" in ('pending','approved','rejected','cancelled','expired','refunded','partially_refunded','charged_back'))
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job" text NOT NULL,
	"invocation_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"stats" jsonb,
	"error" text,
	CONSTRAINT "job_runs_status_check" CHECK ("job_runs"."status" in ('running','ok','error'))
);
--> statement-breakpoint
CREATE TABLE "payment_customers" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_customers_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charge_id" uuid NOT NULL,
	"booking_id" uuid,
	"provider" text NOT NULL,
	"external_id" text,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount_cents" > 0),
	CONSTRAINT "refunds_status_check" CHECK ("refunds"."status" in ('pending','approved','failed'))
);
--> statement-breakpoint
CREATE TABLE "saved_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_card_id" text NOT NULL,
	"brand" text,
	"last4" char(4),
	"exp_month" smallint,
	"exp_year" smallint,
	"recurring_consent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "saved_cards_provider_card_uq" UNIQUE("provider","external_card_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_status" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "webhook_events_provider_external_status_uq" UNIQUE("provider","external_id","external_status")
);
--> statement-breakpoint
ALTER TABLE "booking_categories" ADD CONSTRAINT "booking_categories_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reschedule_requests" ADD CONSTRAINT "booking_reschedule_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reschedule_requests" ADD CONSTRAINT "booking_reschedule_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reschedule_requests" ADD CONSTRAINT "booking_reschedule_requests_new_room_id_rooms_id_fk" FOREIGN KEY ("new_room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reschedule_requests" ADD CONSTRAINT "booking_reschedule_requests_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reschedule_requests" ADD CONSTRAINT "booking_reschedule_requests_hold_block_id_blocks_id_fk" FOREIGN KEY ("hold_block_id") REFERENCES "public"."blocks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_segments" ADD CONSTRAINT "booking_segments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_segments" ADD CONSTRAINT "booking_segments_category_id_booking_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."booking_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmed_manually_by_users_id_fk" FOREIGN KEY ("confirmed_manually_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cleanup_overridden_by_users_id_fk" FOREIGN KEY ("cleanup_overridden_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_customers" ADD CONSTRAINT "payment_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_cards" ADD CONSTRAINT "saved_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_categories_reference_uq" ON "booking_categories" USING btree ("is_reference") WHERE "booking_categories"."is_reference";--> statement-breakpoint
CREATE INDEX "booking_events_booking_idx" ON "booking_events" USING btree ("booking_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_reschedule_requests_pending_uq" ON "booking_reschedule_requests" USING btree ("booking_id") WHERE "booking_reschedule_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "bookings_user_starts_idx" ON "bookings" USING btree ("user_id","starts_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bookings_room_starts_idx" ON "bookings" USING btree ("room_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_status_hold_idx" ON "bookings" USING btree ("status","hold_expires_at");--> statement-breakpoint
CREATE INDEX "bookings_status_balance_charge_idx" ON "bookings" USING btree ("status","balance_charge_at");--> statement-breakpoint
CREATE INDEX "bookings_user_awaiting_idx" ON "bookings" USING btree ("user_id","status") WHERE "bookings"."status" = 'awaiting_payment';--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_payment_link_uq" ON "bookings" USING btree ("payment_link_token_hash") WHERE "bookings"."payment_link_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "charges_provider_external_uq" ON "charges" USING btree ("provider","external_id") WHERE "charges"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "charges_status_created_idx" ON "charges" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "charges_booking_idx" ON "charges" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "job_runs_job_started_idx" ON "job_runs" USING btree ("job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "refunds_charge_idx" ON "refunds" USING btree ("charge_id");