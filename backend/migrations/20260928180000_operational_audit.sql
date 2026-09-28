-- Audit only operational changes. No Google raw payloads, photos or credentials.
CREATE TABLE IF NOT EXISTS public.appointment_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  appointment_id BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointment_audit_timeline
  ON public.appointment_audit (appointment_id, occurred_at DESC, id DESC);

ALTER TABLE public.appointment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointment_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.appointment_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.appointment_audit_id_seq TO service_role;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS vehicle_assigned_by TEXT;
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS audit_actor_id TEXT;

REVOKE SELECT (vehicle_assigned_by), UPDATE (vehicle_assigned_by)
  ON public.appointments FROM PUBLIC, anon, authenticated;
REVOKE SELECT (audit_actor_id), UPDATE (audit_actor_id)
  ON public.reservations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_appointment_created()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.appointment_audit (appointment_id, event_type, actor_name, details)
  VALUES (NEW.id, 'created', 'Agenda', jsonb_build_object('title', NEW.title));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_appointment_created ON public.appointments;
CREATE TRIGGER trg_audit_appointment_created
AFTER INSERT ON public.appointments FOR EACH ROW
EXECUTE FUNCTION public.audit_appointment_created();

CREATE OR REPLACE FUNCTION public.audit_appointment_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     OR NEW.workflow_assignee_id IS DISTINCT FROM OLD.workflow_assignee_id THEN
    INSERT INTO public.appointment_audit (appointment_id, event_type, actor_id, details)
    VALUES (NEW.id, 'workflow', CASE WHEN NEW.workflow_assigned_at IS DISTINCT FROM OLD.workflow_assigned_at
      THEN NEW.workflow_assigned_by ELSE NULL END,
      jsonb_build_object('from', OLD.workflow_status, 'to', NEW.workflow_status,
        'assignee_id', NEW.workflow_assignee_id));
  END IF;

  IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
    INSERT INTO public.appointment_audit (appointment_id, event_type, actor_id, details)
    VALUES (NEW.id, 'vehicle', CASE WHEN NEW.vehicle_assigned_at IS DISTINCT FROM OLD.vehicle_assigned_at
      THEN NEW.vehicle_assigned_by ELSE NULL END,
      jsonb_build_object('from_vehicle_id', OLD.vehicle_id, 'to_vehicle_id', NEW.vehicle_id));
  END IF;

  -- A change imported from Google changes the etag and the visible schedule.
  -- Local edits are captured by calendar_outbox instead, avoiding duplicate entries.
  IF NEW.google_etag IS DISTINCT FROM OLD.google_etag
     AND NEW.google_sync_status = 'synced'
     AND (NEW.title, NEW.client_name, NEW.client_address, NEW.appointment_date,
       NEW.appointment_time, NEW.technician_names)
       IS DISTINCT FROM
       (OLD.title, OLD.client_name, OLD.client_address, OLD.appointment_date,
       OLD.appointment_time, OLD.technician_names) THEN
    INSERT INTO public.appointment_audit (appointment_id, event_type, actor_name, details)
    VALUES (NEW.id, 'google_update', 'Google Agenda',
      jsonb_build_object('before', jsonb_build_object('title', OLD.title, 'date', OLD.appointment_date,
        'time', OLD.appointment_time, 'team', OLD.technician_names),
        'after', jsonb_build_object('title', NEW.title, 'date', NEW.appointment_date,
        'time', NEW.appointment_time, 'team', NEW.technician_names)));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_appointment_update ON public.appointments;
CREATE TRIGGER trg_audit_appointment_update
AFTER UPDATE ON public.appointments FOR EACH ROW
EXECUTE FUNCTION public.audit_appointment_update();

CREATE OR REPLACE FUNCTION public.audit_calendar_outbox()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.appointment_audit (appointment_id, event_type, actor_id, details)
  VALUES (NEW.appointment_id, 'calendar_edit', NEW.actor_id,
    jsonb_build_object('fields', COALESCE((
      SELECT jsonb_agg(key) FROM jsonb_object_keys(NEW.event_patch) AS key
    ), '[]'::jsonb)));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_calendar_outbox ON public.calendar_outbox;
CREATE TRIGGER trg_audit_calendar_outbox
AFTER INSERT ON public.calendar_outbox FOR EACH ROW
EXECUTE FUNCTION public.audit_calendar_outbox();

CREATE OR REPLACE FUNCTION public.audit_reservation_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE appointment BIGINT; event_name TEXT;
BEGIN
  appointment := NEW.appointment_id;
  IF appointment IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    event_name := 'pattern_reserved';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    event_name := CASE WHEN NEW.status = 'Em Uso' THEN 'pattern_checkout'
      WHEN NEW.status = 'Devolvido' THEN 'pattern_return'
      ELSE 'pattern_status' END;
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO public.appointment_audit (appointment_id, event_type, actor_id, details)
  VALUES (appointment, event_name, NEW.audit_actor_id,
    jsonb_build_object('analyzer_id', NEW.analyzer_id, 'reservation_id', NEW.id, 'status', NEW.status));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_reservation_change ON public.reservations;
CREATE TRIGGER trg_audit_reservation_change
AFTER INSERT OR UPDATE ON public.reservations FOR EACH ROW
EXECUTE FUNCTION public.audit_reservation_change();

CREATE OR REPLACE FUNCTION public.audit_fleet_usage_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.appointment_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.appointment_audit (appointment_id, event_type, actor_id, actor_name, details)
    VALUES (NEW.appointment_id, 'vehicle_checkout', NEW.withdrawn_by_user_id,
      NEW.withdrawn_by_name, jsonb_build_object('vehicle_id', NEW.vehicle_id, 'usage_id', NEW.id));
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'Em Uso' THEN
    INSERT INTO public.appointment_audit (appointment_id, event_type, actor_id, actor_name, details)
    VALUES (NEW.appointment_id, 'vehicle_return', NEW.returned_by_user_id,
      NEW.returned_by_name, jsonb_build_object('vehicle_id', NEW.vehicle_id, 'usage_id', NEW.id));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_fleet_usage_change ON public.fleet_usage;
CREATE TRIGGER trg_audit_fleet_usage_change
AFTER INSERT OR UPDATE ON public.fleet_usage FOR EACH ROW
EXECUTE FUNCTION public.audit_fleet_usage_change();

REVOKE EXECUTE ON FUNCTION public.audit_appointment_created(), public.audit_appointment_update(),
  public.audit_calendar_outbox(), public.audit_reservation_change(),
  public.audit_fleet_usage_change() FROM PUBLIC, anon, authenticated;
