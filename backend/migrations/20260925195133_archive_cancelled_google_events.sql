-- Preserve the exact Google tombstones and linked operational data before
-- removing old duplicate calendar rows. The archive schema is not exposed by
-- the Supabase Data API.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE SCHEMA IF NOT EXISTS atem_archive;
REVOKE ALL ON SCHEMA atem_archive FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA atem_archive TO service_role;

CREATE TABLE IF NOT EXISTS atem_archive.cancelled_google_appointments_20260925 (
  appointment_id bigint PRIMARY KEY,
  archived_at timestamptz NOT NULL DEFAULT now(),
  appointment jsonb NOT NULL,
  technicians jsonb NOT NULL,
  equipments jsonb NOT NULL,
  reservations jsonb NOT NULL,
  fleet_usage jsonb NOT NULL,
  notification_logs jsonb NOT NULL,
  outbox jsonb NOT NULL
);
ALTER TABLE atem_archive.cancelled_google_appointments_20260925 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON atem_archive.cancelled_google_appointments_20260925 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON atem_archive.cancelled_google_appointments_20260925 TO service_role;

INSERT INTO atem_archive.cancelled_google_appointments_20260925
  (appointment_id, appointment, technicians, equipments, reservations, fleet_usage, notification_logs, outbox)
SELECT a.id, to_jsonb(a),
  COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.appointment_technicians t WHERE t.appointment_id=a.id), '[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM public.appointment_equipments e WHERE e.appointment_id=a.id), '[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM public.reservations r WHERE r.appointment_id=a.id), '[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM public.fleet_usage f WHERE f.appointment_id=a.id), '[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM public.notification_logs n WHERE n.appointment_id=a.id), '[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM public.calendar_outbox o WHERE o.appointment_id=a.id), '[]'::jsonb)
FROM public.appointments a
WHERE a.google_calendar_id IS NOT NULL AND a.google_event->>'status'='cancelled'
ON CONFLICT (appointment_id) DO NOTHING;

COMMIT;
