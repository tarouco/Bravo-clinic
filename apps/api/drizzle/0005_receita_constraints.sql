-- Custom SQL migration: receita constraints Drizzle cannot express (docs/architecture.md section 5.4,
-- AD-030). Checks and partial unique indexes of the receita tables live in 0004_receita.sql.
ALTER TABLE slot_discounts ADD CONSTRAINT slot_discounts_no_overlap
  EXCLUDE USING gist (room_id WITH =, period WITH &&)
  WHERE (removed_at IS NULL AND consumed_by_booking_id IS NULL);--> statement-breakpoint
ALTER TABLE slot_discounts ADD CONSTRAINT slot_discounts_period_shape
  CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period));--> statement-breakpoint
CREATE TRIGGER package_ledger_append_only BEFORE UPDATE OR DELETE ON package_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER extra_minutes_ledger_append_only BEFORE UPDATE OR DELETE ON extra_minutes_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER credit_ledger_append_only BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();--> statement-breakpoint
-- A coupon use only moves reserved -> consumed | released, every other column is frozen, and a use
-- is never deleted (design.md "Data Models").
CREATE OR REPLACE FUNCTION coupon_uses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append_only_table: % on %', TG_OP, TG_TABLE_NAME;
  END IF;
  IF OLD.status <> 'reserved' OR NEW.status NOT IN ('consumed', 'released')
     OR NEW.coupon_id IS DISTINCT FROM OLD.coupon_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.doc_number IS DISTINCT FROM OLD.doc_number
     OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
     OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.discount_cents IS DISTINCT FROM OLD.discount_cents
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'invalid_coupon_use_transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER coupon_uses_transition BEFORE UPDATE OR DELETE ON coupon_uses
  FOR EACH ROW EXECUTE FUNCTION coupon_uses_guard();
