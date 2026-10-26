-- Custom SQL migration: constraints Drizzle cannot express (docs/architecture.md section 5.1).
-- The checks and partial unique indexes of the nucleo tables live in 0002_nucleo.sql (generated).
CREATE TRIGGER booking_events_append_only BEFORE UPDATE OR DELETE ON booking_events
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
