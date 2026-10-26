CREATE TABLE "closed_day_compensations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"closed_day_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"minutes" integer,
	"amount_cents" integer,
	"extra_minute_lot_id" uuid,
	"credit_lot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closed_day_compensations_day_subscription_uq" UNIQUE("closed_day_id","subscription_id"),
	CONSTRAINT "closed_day_compensations_kind_check" CHECK ("closed_day_compensations"."kind" in ('minutes','credit'))
);
--> statement-breakpoint
CREATE TABLE "extra_hours_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"hours" smallint NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"status" text NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "extra_hours_purchases_hours_check" CHECK ("extra_hours_purchases"."hours" between 1 and 100),
	CONSTRAINT "extra_hours_purchases_status_check" CHECK ("extra_hours_purchases"."status" in ('awaiting_payment','paid','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "package_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "package_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subscription_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"minutes" integer NOT NULL,
	"booking_id" uuid,
	"detail" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_ledger_entry_type_check" CHECK ("package_ledger"."entry_type" in ('period_grant','debit','refund','expiry','conversion_in','conversion_out','manual_adjustment'))
);
--> statement-breakpoint
CREATE TABLE "subscription_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"price_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"occurrence_count" integer,
	"included_minutes" integer,
	"minutes_balance" integer,
	"price_snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"charge_due_at" timestamp with time zone NOT NULL,
	"renewal_attempts" smallint DEFAULT 0 NOT NULL,
	"held_conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_periods_subscription_seq_uq" UNIQUE("subscription_id","seq"),
	CONSTRAINT "subscription_periods_status_check" CHECK ("subscription_periods"."status" in ('upcoming','awaiting_payment','paid','active','closed','failed','cancelled')),
	CONSTRAINT "subscription_periods_minutes_balance_check" CHECK ("subscription_periods"."minutes_balance" is null or "subscription_periods"."minutes_balance" >= 0),
	CONSTRAINT "subscription_periods_dates_check" CHECK ("subscription_periods"."ends_on" > "subscription_periods"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"type" text NOT NULL,
	"room_id" uuid,
	"status" text NOT NULL,
	"base_on" date NOT NULL,
	"period_days" smallint NOT NULL,
	"price_snapshot" jsonb NOT NULL,
	"payment_method" text NOT NULL,
	"saved_card_id" uuid,
	"first_coupon_id" uuid,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"switched_to_subscription_id" uuid,
	"switch_from_subscription_id" uuid,
	"hold_expires_at" timestamp with time zone,
	"sale_mode" text DEFAULT 'self' NOT NULL,
	"source" text NOT NULL,
	"created_by" uuid,
	"suspended_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_type_check" CHECK ("subscriptions"."type" in ('hour_package','fixed_schedule')),
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('awaiting_payment','active','suspended','ended','cancelled','switched','expired')),
	CONSTRAINT "subscriptions_period_days_check" CHECK ("subscriptions"."period_days" in (30,60,90)),
	CONSTRAINT "subscriptions_payment_method_check" CHECK ("subscriptions"."payment_method" in ('saved_card','pix')),
	CONSTRAINT "subscriptions_sale_mode_check" CHECK ("subscriptions"."sale_mode" in ('self','link','manual')),
	CONSTRAINT "subscriptions_source_check" CHECK ("subscriptions"."source" in ('web','app','admin','mcp')),
	CONSTRAINT "subscriptions_fixed_room_check" CHECK ("subscriptions"."type" <> 'fixed_schedule' or "subscriptions"."room_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credit_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"lot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"booking_id" uuid,
	"charge_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_entry_type_check" CHECK ("credit_ledger"."entry_type" in ('grant','use','refund','expiry','manual_adjustment'))
);
--> statement-breakpoint
CREATE TABLE "credit_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"remaining_cents" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"justification" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_lots_source_check" CHECK ("credit_lots"."source" in ('reschedule_difference','closed_day_compensation','manual','clinic_cancellation')),
	CONSTRAINT "credit_lots_amount_check" CHECK ("credit_lots"."amount_cents" > 0),
	CONSTRAINT "credit_lots_remaining_check" CHECK ("credit_lots"."remaining_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "extra_minute_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"purchase_id" uuid,
	"minutes_granted" integer NOT NULL,
	"minutes_remaining" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extra_minute_lots_source_check" CHECK ("extra_minute_lots"."source" in ('purchase','closed_day_compensation','manual')),
	CONSTRAINT "extra_minute_lots_granted_check" CHECK ("extra_minute_lots"."minutes_granted" > 0),
	CONSTRAINT "extra_minute_lots_remaining_check" CHECK ("extra_minute_lots"."minutes_remaining" >= 0)
);
--> statement-breakpoint
CREATE TABLE "extra_minutes_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "extra_minutes_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"lot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_type" text NOT NULL,
	"minutes" integer NOT NULL,
	"booking_id" uuid,
	"detail" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extra_minutes_ledger_entry_type_check" CHECK ("extra_minutes_ledger"."entry_type" in ('grant','debit','refund','expiry','manual_adjustment'))
);
--> statement-breakpoint
CREATE TABLE "coupon_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"doc_number" text,
	"booking_id" uuid,
	"subscription_id" uuid,
	"discount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_uses_status_check" CHECK ("coupon_uses"."status" in ('reserved','consumed','released')),
	CONSTRAINT "coupon_uses_discount_check" CHECK ("coupon_uses"."discount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"discount_kind" text NOT NULL,
	"discount_value" integer NOT NULL,
	"applies_to" text NOT NULL,
	"max_uses" integer,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"per_customer_limit" integer,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_type_check" CHECK ("coupons"."type" in ('first_booking','discount')),
	CONSTRAINT "coupons_discount_kind_check" CHECK ("coupons"."discount_kind" in ('percent','fixed')),
	CONSTRAINT "coupons_discount_value_check" CHECK ("coupons"."discount_value" > 0),
	CONSTRAINT "coupons_applies_to_check" CHECK ("coupons"."applies_to" in ('bookings','packages','both')),
	CONSTRAINT "coupons_first_booking_check" CHECK ("coupons"."type" <> 'first_booking' or "coupons"."applies_to" = 'bookings'),
	CONSTRAINT "coupons_uses_count_check" CHECK ("coupons"."uses_count" >= 0),
	CONSTRAINT "coupons_max_uses_check" CHECK ("coupons"."max_uses" is null or "coupons"."uses_count" <= "coupons"."max_uses")
);
--> statement-breakpoint
CREATE TABLE "slot_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"percent" smallint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"consumed_by_booking_id" uuid,
	CONSTRAINT "slot_discounts_percent_check" CHECK ("slot_discounts"."percent" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "coupon_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "subscription_period_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "package_minutes_debited" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "extra_minutes_debited" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "subscription_period_id" uuid;--> statement-breakpoint
ALTER TABLE "charges" ADD COLUMN "extra_hours_purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "closed_day_compensations" ADD CONSTRAINT "closed_day_compensations_closed_day_id_closed_days_id_fk" FOREIGN KEY ("closed_day_id") REFERENCES "public"."closed_days"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_day_compensations" ADD CONSTRAINT "closed_day_compensations_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_day_compensations" ADD CONSTRAINT "closed_day_compensations_period_id_subscription_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."subscription_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_day_compensations" ADD CONSTRAINT "closed_day_compensations_extra_minute_lot_id_extra_minute_lots_id_fk" FOREIGN KEY ("extra_minute_lot_id") REFERENCES "public"."extra_minute_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_day_compensations" ADD CONSTRAINT "closed_day_compensations_credit_lot_id_credit_lots_id_fk" FOREIGN KEY ("credit_lot_id") REFERENCES "public"."credit_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_hours_purchases" ADD CONSTRAINT "extra_hours_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_hours_purchases" ADD CONSTRAINT "extra_hours_purchases_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_ledger" ADD CONSTRAINT "package_ledger_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_ledger" ADD CONSTRAINT "package_ledger_period_id_subscription_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."subscription_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_ledger" ADD CONSTRAINT "package_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_ledger" ADD CONSTRAINT "package_ledger_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_ledger" ADD CONSTRAINT "package_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_category_id_booking_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."booking_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_saved_card_id_saved_cards_id_fk" FOREIGN KEY ("saved_card_id") REFERENCES "public"."saved_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_first_coupon_id_coupons_id_fk" FOREIGN KEY ("first_coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_switched_to_subscription_id_subscriptions_id_fk" FOREIGN KEY ("switched_to_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_switch_from_subscription_id_subscriptions_id_fk" FOREIGN KEY ("switch_from_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_lot_id_credit_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."credit_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_lots" ADD CONSTRAINT "credit_lots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_lots" ADD CONSTRAINT "credit_lots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_minute_lots" ADD CONSTRAINT "extra_minute_lots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_minute_lots" ADD CONSTRAINT "extra_minute_lots_purchase_id_extra_hours_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."extra_hours_purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_minutes_ledger" ADD CONSTRAINT "extra_minutes_ledger_lot_id_extra_minute_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."extra_minute_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_minutes_ledger" ADD CONSTRAINT "extra_minutes_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_minutes_ledger" ADD CONSTRAINT "extra_minutes_ledger_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_minutes_ledger" ADD CONSTRAINT "extra_minutes_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_uses" ADD CONSTRAINT "coupon_uses_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_uses" ADD CONSTRAINT "coupon_uses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_uses" ADD CONSTRAINT "coupon_uses_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_uses" ADD CONSTRAINT "coupon_uses_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_discounts" ADD CONSTRAINT "slot_discounts_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_discounts" ADD CONSTRAINT "slot_discounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_discounts" ADD CONSTRAINT "slot_discounts_consumed_by_booking_id_bookings_id_fk" FOREIGN KEY ("consumed_by_booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extra_hours_purchases_status_hold_idx" ON "extra_hours_purchases" USING btree ("status","hold_expires_at");--> statement-breakpoint
CREATE INDEX "package_ledger_period_idx" ON "package_ledger" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "package_ledger_user_created_idx" ON "package_ledger" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "package_ledger_subscription_created_idx" ON "package_ledger" USING btree ("subscription_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "subscription_periods_status_due_idx" ON "subscription_periods" USING btree ("status","charge_due_at");--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_status_base_idx" ON "subscriptions" USING btree ("status","base_on");--> statement-breakpoint
CREATE INDEX "subscriptions_status_hold_idx" ON "subscriptions" USING btree ("status","hold_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_hour_pkg" ON "subscriptions" USING btree ("user_id") WHERE "subscriptions"."type" = 'hour_package' and "subscriptions"."status" in ('awaiting_payment','active','suspended');--> statement-breakpoint
CREATE INDEX "credit_ledger_lot_idx" ON "credit_ledger" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_created_idx" ON "credit_ledger" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credit_ledger_charge_idx" ON "credit_ledger" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "credit_lots_user_expires_idx" ON "credit_lots" USING btree ("user_id","expires_at") WHERE "credit_lots"."remaining_cents" > 0;--> statement-breakpoint
CREATE INDEX "extra_minute_lots_user_expires_idx" ON "extra_minute_lots" USING btree ("user_id","expires_at") WHERE "extra_minute_lots"."minutes_remaining" > 0;--> statement-breakpoint
CREATE INDEX "extra_minutes_ledger_lot_idx" ON "extra_minutes_ledger" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "extra_minutes_ledger_user_created_idx" ON "extra_minutes_ledger" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "coupon_uses_coupon_idx" ON "coupon_uses" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX "coupon_uses_doc_idx" ON "coupon_uses" USING btree ("doc_number");--> statement-breakpoint
CREATE INDEX "coupon_uses_user_idx" ON "coupon_uses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_uses_coupon_booking_uq" ON "coupon_uses" USING btree ("coupon_id","booking_id") WHERE "coupon_uses"."booking_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_uses_coupon_subscription_uq" ON "coupon_uses" USING btree ("coupon_id","subscription_id") WHERE "coupon_uses"."subscription_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_uq" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "slot_discounts_room_idx" ON "slot_discounts" USING btree ("room_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_subscription_period_id_subscription_periods_id_fk" FOREIGN KEY ("subscription_period_id") REFERENCES "public"."subscription_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_subscription_period_id_subscription_periods_id_fk" FOREIGN KEY ("subscription_period_id") REFERENCES "public"."subscription_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_extra_hours_purchase_id_extra_hours_purchases_id_fk" FOREIGN KEY ("extra_hours_purchase_id") REFERENCES "public"."extra_hours_purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_subscription_idx" ON "bookings" USING btree ("subscription_id","starts_at") WHERE "bookings"."subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "charges_period_idx" ON "charges" USING btree ("subscription_period_id") WHERE "charges"."subscription_period_id" is not null;