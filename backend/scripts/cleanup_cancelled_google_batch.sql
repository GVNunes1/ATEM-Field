-- Run repeatedly through Supabase MCP until remaining_archived_tombstones = 0.
-- Each batch locks only rows that the Google event itself marks cancelled.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $$
DECLARE item_id bigint;
BEGIN
  FOR item_id IN
    SELECT a.id FROM public.appointments a
    JOIN atem_archive.cancelled_google_appointments_20260925 saved ON saved.appointment_id=a.id
    WHERE a.google_calendar_id IS NOT NULL AND a.google_event->>'status'='cancelled'
    ORDER BY a.id LIMIT 150 FOR UPDATE OF a SKIP LOCKED
  LOOP
    IF EXISTS (SELECT 1 FROM public.appointments
        WHERE id=item_id AND google_event->>'status'='cancelled') THEN
      PERFORM public.calendar_remove_appointment(item_id);
    END IF;
  END LOOP;
END $$;

COMMIT;
SELECT count(*) AS remaining_archived_tombstones
FROM public.appointments a
JOIN atem_archive.cancelled_google_appointments_20260925 saved ON saved.appointment_id=a.id
WHERE a.google_event->>'status'='cancelled';
