-- Additive calendar integration. App JWT authorization stays in Express;
-- synchronization metadata and RPCs are accessible only to service_role.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS appointment_end_date date,
  ADD COLUMN IF NOT EXISTS appointment_end_time text,
  ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_calendar_id text,
  ADD COLUMN IF NOT EXISTS google_event_id text,
  ADD COLUMN IF NOT EXISTS google_etag text,
  ADD COLUMN IF NOT EXISTS google_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS google_event jsonb,
  ADD COLUMN IF NOT EXISTS calendar_writable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_sync_status text NOT NULL DEFAULT 'unlinked',
  ADD COLUMN IF NOT EXISTS google_sync_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS google_sync_error text,
  ADD COLUMN IF NOT EXISTS google_sync_conflict jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_google_identity
  ON public.appointments(google_calendar_id, google_event_id)
  WHERE google_calendar_id IS NOT NULL AND google_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.calendar_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id bigint NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  calendar_id text NOT NULL,
  event_id text NOT NULL,
  expected_etag text NOT NULL,
  event_patch jsonb NOT NULL,
  actor_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','error','conflict','sent','resolved')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_outbox_one_pending
  ON public.calendar_outbox(appointment_id) WHERE status IN ('pending','error','conflict');
CREATE INDEX IF NOT EXISTS calendar_outbox_appointment ON public.calendar_outbox(appointment_id);
CREATE INDEX IF NOT EXISTS calendar_outbox_pending ON public.calendar_outbox(created_at) WHERE status IN ('pending','error');

-- Durable lease coordinates separate API workers. Tokens are owned by a worker,
-- never by a user. The lease is renewed before every remote call.
CREATE TABLE IF NOT EXISTS public.calendar_sync_control (
  id integer PRIMARY KEY CHECK (id = 1),
  lease_owner uuid,
  lease_until timestamptz,
  imported_once boolean NOT NULL DEFAULT false
);
INSERT INTO public.calendar_sync_control(id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.calendar_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_outbox, public.calendar_sync_control FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.calendar_outbox, public.calendar_sync_control TO service_role;

CREATE OR REPLACE FUNCTION public.calendar_lease(p_owner uuid, p_release boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_release THEN
    UPDATE public.calendar_sync_control SET lease_owner = NULL, lease_until = NULL WHERE id = 1 AND lease_owner = p_owner;
  ELSE
    UPDATE public.calendar_sync_control SET lease_owner = p_owner, lease_until = now() + interval '6 minutes'
      WHERE id = 1 AND (lease_owner = p_owner OR lease_until IS NULL OR lease_until < now());
  END IF;
  RETURN FOUND;
END $$;

-- One transaction saves the edit, team and outbound operation. A second local
-- edit is rejected until the first is synchronized/resolved (optimistic lock).
CREATE OR REPLACE FUNCTION public.calendar_queue_edit(
  p_id bigint, p_revision integer, p_values jsonb, p_patch jsonb, p_actor text,
  p_resolution boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE a public.appointments; j public.calendar_outbox; op uuid; team bigint[];
BEGIN
  SELECT * INTO a FROM public.appointments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento não encontrado.' USING ERRCODE = 'P0002'; END IF;
  IF a.google_sync_revision <> p_revision THEN RAISE EXCEPTION 'A agenda mudou. Atualize antes de salvar.' USING ERRCODE = '40001'; END IF;
  IF a.google_calendar_id IS NULL OR a.google_event_id IS NULL OR a.google_etag IS NULL OR NOT a.calendar_writable THEN
    RAISE EXCEPTION 'Sincronize uma agenda Google com permissão de edição antes de salvar.';
  END IF;
  IF p_resolution THEN
    IF a.google_sync_status <> 'conflict' OR a.google_sync_conflict->>'etag' IS NULL THEN RAISE EXCEPTION 'Não há conflito válido para resolver.'; END IF;
    IF a.google_sync_conflict->>'status' = 'cancelled' THEN RAISE EXCEPTION 'Evento excluído no Google. Aceite a exclusão antes de criar outro evento.'; END IF;
    SELECT * INTO j FROM public.calendar_outbox WHERE appointment_id = p_id AND status = 'conflict' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Operação em conflito não encontrada.'; END IF;
    p_patch := j.event_patch;
    a.google_etag := a.google_sync_conflict->>'etag';
    UPDATE public.calendar_outbox SET status = 'resolved', updated_at = now() WHERE id = j.id;
  ELSE
    IF a.google_sync_status <> 'synced' THEN RAISE EXCEPTION 'Conclua ou resolva a sincronização pendente antes de editar.' USING ERRCODE = '40001'; END IF;
    team := ARRAY(SELECT jsonb_array_elements_text(p_values->'technician_ids')::bigint);
    IF (SELECT count(*) FROM public.technicians WHERE id = ANY(team)) <> cardinality(team) THEN RAISE EXCEPTION 'Equipe inválida.'; END IF;
    UPDATE public.appointments SET
      title = p_values->>'title', client_name = p_values->>'client_name', client_address = p_values->>'client_address',
      appointment_date = (p_values->>'appointment_date')::date, appointment_time = p_values->>'appointment_time',
      appointment_end_date = (p_values->>'appointment_end_date')::date, appointment_end_time = p_values->>'appointment_end_time',
      all_day = (p_values->>'all_day')::boolean, technician_id = team[1],
      technician_names = COALESCE((SELECT string_agg(name, ', ' ORDER BY name) FROM public.technicians WHERE id = ANY(team)), 'Equipe de Campo'),
      last_activity_at = now() WHERE id = p_id;
    DELETE FROM public.appointment_technicians WHERE appointment_id = p_id;
    INSERT INTO public.appointment_technicians(appointment_id, technician_id) SELECT p_id, unnest(team);
    UPDATE public.reservations SET reserved_date = (p_values->>'appointment_date')::date
      WHERE appointment_id = p_id AND status IN ('Reservado','Aguardando Aprovação');
  END IF;
  INSERT INTO public.calendar_outbox(appointment_id, calendar_id, event_id, expected_etag, event_patch, actor_id)
    VALUES(p_id, a.google_calendar_id, a.google_event_id, a.google_etag, p_patch, p_actor) RETURNING id INTO op;
  UPDATE public.appointments SET google_sync_status = 'pending', google_sync_revision = google_sync_revision + 1,
    google_sync_error = NULL, google_sync_conflict = NULL, last_activity_at = now()
    WHERE id = p_id RETURNING * INTO a;
  RETURN to_jsonb(a);
END $$;

-- All inbound mutations and acknowledgments are atomic with team links and
-- reservations. Pending local data is never overwritten by a background pull.
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
  ELSIF a.google_etag = p_event->>'etag' OR a.google_updated_at > (p_event->>'updated')::timestamptz THEN
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

CREATE OR REPLACE FUNCTION public.calendar_fail(p_operation uuid, p_error text, p_remote jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE j public.calendar_outbox;
BEGIN
  SELECT * INTO j FROM public.calendar_outbox WHERE id = p_operation;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM public.appointments WHERE id = j.appointment_id FOR UPDATE;
  UPDATE public.calendar_outbox SET status = CASE WHEN p_remote IS NULL THEN 'error' ELSE 'conflict' END,
    attempts = attempts + 1, last_error = p_error, updated_at = now()
    WHERE id = p_operation AND status IN ('pending','error','conflict');
  IF FOUND THEN
    UPDATE public.appointments SET google_sync_status = CASE WHEN p_remote IS NULL THEN 'error' ELSE 'conflict' END,
      google_sync_error = p_error, google_sync_conflict = p_remote, google_sync_revision = google_sync_revision + 1
      WHERE id = j.appointment_id;
  END IF;
END $$;

REVOKE SELECT, UPDATE ON public.appointments FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, external_id, title, client_name, client_address, client_contact, appointment_date, appointment_time, appointment_end_date, appointment_end_time, all_day, status, technician_names, technician_id, created_at, workflow_status, workflow_validated_at, commercial_confirmed_at, last_activity_at, vehicle_id, vehicle_assigned_at, google_calendar_id, google_event_id, google_etag, google_updated_at, calendar_writable, google_sync_status, google_sync_revision, google_sync_error) ON public.appointments TO anon, authenticated;
GRANT UPDATE (id, external_id, title, client_name, client_address, client_contact, appointment_date, appointment_time, appointment_end_date, appointment_end_time, all_day, status, technician_names, technician_id, created_at, workflow_status, workflow_validated_at, commercial_confirmed_at, last_activity_at, vehicle_id, vehicle_assigned_at, google_calendar_id, google_event_id, google_etag, google_updated_at, calendar_writable) ON public.appointments TO anon, authenticated;
REVOKE ALL ON FUNCTION public.calendar_lease(uuid,boolean),
  public.calendar_queue_edit(bigint,integer,jsonb,jsonb,text,boolean),
  public.calendar_ingest(text,jsonb,jsonb,bigint[],boolean,bigint,integer),
  public.calendar_fail(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_lease(uuid,boolean),
  public.calendar_queue_edit(bigint,integer,jsonb,jsonb,text,boolean),
  public.calendar_ingest(text,jsonb,jsonb,bigint[],boolean,bigint,integer),
  public.calendar_fail(uuid,text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
