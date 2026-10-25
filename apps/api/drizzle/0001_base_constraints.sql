-- Custom SQL migration: constraints Drizzle cannot express (docs/architecture.md section 5.1, AD-004).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE room_occupancy ADD CONSTRAINT room_occupancy_no_overlap
  EXCLUDE USING gist (room_id WITH =, period WITH &&) WHERE (active);--> statement-breakpoint
ALTER TABLE room_occupancy ADD CONSTRAINT room_occupancy_period_shape
  CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period));--> statement-breakpoint
CREATE INDEX room_occupancy_period_active_idx ON room_occupancy USING gist (period) WHERE active;--> statement-breakpoint
CREATE UNIQUE INDEX closed_days_uq ON closed_days (date, coalesce(room_id, '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only_table: % on %', TG_OP, TG_TABLE_NAME;
END
$$;--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER consents_append_only BEFORE UPDATE OR DELETE ON consents
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
