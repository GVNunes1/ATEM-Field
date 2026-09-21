-- Cancellation removes the appointment, not the operational loan history.
BEGIN;

-- Specialty determines access: browser roles must not be able to promote
-- themselves or read credential material via the legacy permissive policy.
REVOKE ALL ON public.technicians FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, name, role, status, avatar_url) ON public.technicians TO anon, authenticated;
GRANT ALL ON public.technicians TO service_role;
DO $$ BEGIN
  IF to_regclass('public.app_credentials') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.app_credentials FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT ALL ON public.app_credentials TO service_role';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.calendar_remove_appointment(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE linked_assets bigint[];
BEGIN
  PERFORM 1 FROM public.appointments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('deleted',false); END IF;

  PERFORM 1 FROM public.reservations WHERE appointment_id = p_id ORDER BY id FOR UPDATE;
  SELECT array_agg(DISTINCT analyzer_id) INTO linked_assets
    FROM public.reservations WHERE appointment_id = p_id;
  PERFORM 1 FROM public.analyzers WHERE id = ANY(linked_assets) ORDER BY id FOR UPDATE;

  -- Detach history before the appointment's cascading FK is evaluated.
  -- Actual checkouts stay open and unavailable until normal return.
  UPDATE public.reservations
    SET appointment_id = NULL,
        status = CASE WHEN status IN ('Reservado','Aguardando Aprovação') THEN 'Cancelado' ELSE status END,
        notes = concat_ws(E'\n', notes, 'Agendamento #' || p_id || ' excluído; histórico preservado.')
    WHERE appointment_id = p_id;
  UPDATE public.analyzers a SET status = 'Disponível'
    WHERE a.id = ANY(linked_assets) AND a.status = 'Reservado'
      AND NOT EXISTS (SELECT 1 FROM public.reservations r WHERE r.analyzer_id = a.id
        AND r.status IN ('Reservado','Aguardando Aprovação','Em Uso','Emprestado'));
  DELETE FROM public.calendar_outbox WHERE appointment_id = p_id;
  -- Team/equipment links cascade; vehicle usage and notification logs keep
  -- their history through their existing ON DELETE SET NULL foreign keys.
  DELETE FROM public.appointments WHERE id = p_id;
  RETURN jsonb_build_object('id',p_id,'deleted',true);
END $$;

REVOKE ALL ON FUNCTION public.calendar_remove_appointment(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_remove_appointment(bigint) TO service_role;
GRANT DELETE ON public.calendar_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.calendar_ingest(
  p_calendar text, p_event jsonb, p_values jsonb, p_team bigint[], p_writable boolean,
  p_resolve_id bigint DEFAULT NULL, p_revision integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.appointments; j public.calendar_outbox; cancelled boolean; acknowledged boolean := false; event_key text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('atem-calendar:' || p_calendar || ':' || (p_event->>'id'), 0));
  event_key := 'GGCAL-' || p_calendar || ':' || (p_event->>'id');
  cancelled := COALESCE(p_event->>'status' = 'cancelled', false);
  SELECT * INTO a FROM public.appointments
    WHERE (google_calendar_id = p_calendar AND google_event_id = p_event->>'id')
       OR (external_id = 'GGCAL-' || (p_event->>'id') AND google_calendar_id IS NULL)
    ORDER BY google_calendar_id NULLS LAST LIMIT 1 FOR UPDATE;
  IF a.id IS NULL THEN
    IF cancelled THEN RETURN jsonb_build_object('ignored',true); END IF;
    INSERT INTO public.appointments(external_id,title) VALUES(event_key,COALESCE(p_values->>'title','Atendimento')) RETURNING * INTO a;
  END IF;
  -- Google tombstones are definitive removals, even if an edit was queued.
  IF cancelled THEN
    PERFORM public.calendar_remove_appointment(a.id);
    RETURN jsonb_build_object('id',a.id,'cancelled',true,'deleted',true);
  END IF;
  SELECT * INTO j FROM public.calendar_outbox WHERE appointment_id = a.id AND status IN ('pending','error','conflict') FOR UPDATE;
  IF p_resolve_id IS NOT NULL THEN
    IF a.id <> p_resolve_id OR a.google_sync_revision <> p_revision OR a.google_sync_status <> 'conflict' THEN
      RAISE EXCEPTION 'O conflito mudou. Atualize antes de resolver.' USING ERRCODE = '40001';
    END IF;
    UPDATE public.calendar_outbox SET status = 'resolved', updated_at = now() WHERE id = j.id;
  ELSIF j.id IS NOT NULL THEN
    acknowledged := p_event#>>'{extendedProperties,private,atem_operation_id}' = j.id::text;
    IF COALESCE(acknowledged, false) THEN
      UPDATE public.calendar_outbox SET status = 'sent', last_error = NULL, updated_at = now() WHERE id = j.id;
    ELSE
      IF p_event->>'etag' IS DISTINCT FROM j.expected_etag THEN
        UPDATE public.appointments SET google_sync_status = 'conflict', google_sync_conflict = p_event,
          google_sync_error = 'O mesmo evento foi alterado no Google. Escolha a versão a manter.',
          google_sync_revision = google_sync_revision + 1 WHERE id = a.id AND google_sync_conflict IS DISTINCT FROM p_event;
        UPDATE public.calendar_outbox SET status = 'conflict', updated_at = now() WHERE id = j.id;
      END IF;
      RETURN jsonb_build_object('preserved_local',true,'id',a.id);
    END IF;
  ELSIF (a.google_etag = p_event->>'etag' OR a.google_updated_at > (p_event->>'updated')::timestamptz) AND a.status IS DISTINCT FROM 'Cancelado' THEN
    RETURN jsonb_build_object('unchanged',true,'id',a.id);
  END IF;
  UPDATE public.appointments SET
    google_calendar_id = p_calendar, google_event_id = p_event->>'id', google_etag = p_event->>'etag',
    google_updated_at = (p_event->>'updated')::timestamptz, google_event = p_event, calendar_writable = p_writable,
    google_sync_status = 'synced', google_sync_error = NULL, google_sync_conflict = NULL,
    google_sync_revision = google_sync_revision + 1,
    title = CASE WHEN cancelled THEN title ELSE p_values->>'title' END,
    client_name = CASE WHEN cancelled THEN client_name ELSE p_values->>'client_name' END,
    client_address = CASE WHEN cancelled THEN client_address ELSE p_values->>'client_address' END,
    appointment_date = CASE WHEN cancelled THEN appointment_date ELSE (p_values->>'appointment_date')::date END,
    appointment_time = CASE WHEN cancelled THEN appointment_time ELSE p_values->>'appointment_time' END,
    appointment_end_date = CASE WHEN cancelled THEN appointment_end_date ELSE (p_values->>'appointment_end_date')::date END,
    appointment_end_time = CASE WHEN cancelled THEN appointment_end_time ELSE p_values->>'appointment_end_time' END,
    all_day = CASE WHEN cancelled THEN all_day ELSE (p_values->>'all_day')::boolean END,
    status = CASE WHEN cancelled THEN 'Cancelado' WHEN status = 'Cancelado' THEN 'Agendado' ELSE status END,
    technician_id = CASE WHEN cancelled THEN technician_id ELSE p_team[1] END,
    technician_names = CASE WHEN cancelled THEN technician_names ELSE COALESCE((SELECT string_agg(name, ', ' ORDER BY name) FROM public.technicians WHERE id = ANY(p_team)), 'Equipe de Campo') END,
    last_activity_at = now() WHERE id = a.id;
  IF NOT cancelled THEN
    DELETE FROM public.appointment_technicians WHERE appointment_id = a.id;
    INSERT INTO public.appointment_technicians(appointment_id, technician_id) SELECT a.id, unnest(p_team);
    UPDATE public.reservations SET reserved_date = (p_values->>'appointment_date')::date
      WHERE appointment_id = a.id AND status IN ('Reservado','Aguardando Aprovação');
  END IF;
  RETURN jsonb_build_object('id',a.id,'cancelled',cancelled,'acknowledged',acknowledged);
END $$;

REVOKE ALL ON FUNCTION public.calendar_ingest(text,jsonb,jsonb,bigint[],boolean,bigint,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_ingest(text,jsonb,jsonb,bigint[],boolean,bigint,integer) TO service_role;

-- Reconcile real Google state on the next successful sync. Do not bulk-delete
-- rows merely because an old local label said Cancelado.
UPDATE public.calendar_sync_control SET imported_once = false WHERE id = 1;
COMMIT;
