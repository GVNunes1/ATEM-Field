-- Complete an in-progress appointment only after every linked asset is back.
-- The appointment row lock serializes simultaneous car/pattern returns.
CREATE OR REPLACE FUNCTION public.finish_workflow_after_asset_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target_appointment_id bigint;
  current_stage text;
  scheduled_vehicle_id bigint;
BEGIN
  IF current_user <> 'service_role' THEN RETURN NEW; END IF;
  target_appointment_id := NEW.appointment_id;
  IF target_appointment_id IS NULL THEN RETURN NEW; END IF;

  SELECT a.workflow_status, a.vehicle_id
    INTO current_stage, scheduled_vehicle_id
    FROM public.appointments AS a
   WHERE a.id = target_appointment_id
   FOR UPDATE;
  IF current_stage IS DISTINCT FROM 'Em execução' THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservations AS r
     WHERE r.appointment_id = target_appointment_id
       AND r.status NOT IN ('Devolvido', 'Cancelado')
  ) OR EXISTS (
    SELECT 1 FROM public.fleet_usage AS u
     WHERE u.appointment_id = target_appointment_id
       AND u.status NOT IN ('Devolvido', 'Devolvido com pendência', 'Cancelado')
  ) THEN RETURN NEW; END IF;

  -- A scheduled vehicle must actually have been returned. Never complete
  -- merely because a reservation exists but the car has not left yet.
  IF scheduled_vehicle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fleet_usage AS u
     WHERE u.appointment_id = target_appointment_id
       AND u.status IN ('Devolvido', 'Devolvido com pendência')
  ) THEN RETURN NEW; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.reservations AS r
     WHERE r.appointment_id = target_appointment_id AND r.status = 'Devolvido'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.fleet_usage AS u
     WHERE u.appointment_id = target_appointment_id
       AND u.status IN ('Devolvido', 'Devolvido com pendência')
  ) THEN RETURN NEW; END IF;

  UPDATE public.appointments AS a
     SET workflow_status = 'Concluído',
         workflow_assignee_id = NULL,
         last_activity_at = now()
   WHERE a.id = target_appointment_id
     AND a.workflow_status = 'Em execução'
     AND COALESCE(lower(a.status), '') <> 'cancelado';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finish_workflow_after_pattern_return ON public.reservations;
CREATE TRIGGER trg_finish_workflow_after_pattern_return
AFTER UPDATE OF status ON public.reservations
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('Devolvido', 'Cancelado'))
EXECUTE FUNCTION public.finish_workflow_after_asset_return();

DROP TRIGGER IF EXISTS trg_finish_workflow_after_vehicle_return ON public.fleet_usage;
CREATE TRIGGER trg_finish_workflow_after_vehicle_return
AFTER UPDATE OF status ON public.fleet_usage
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('Devolvido', 'Devolvido com pendência'))
EXECUTE FUNCTION public.finish_workflow_after_asset_return();

REVOKE EXECUTE ON FUNCTION public.finish_workflow_after_asset_return()
  FROM PUBLIC, anon, authenticated;

-- One-time reconciliation for appointments whose assets were all returned
-- before this automation was installed.
UPDATE public.appointments AS a
   SET workflow_status = 'Concluído',
       workflow_assignee_id = NULL,
       last_activity_at = now()
 WHERE a.workflow_status = 'Em execução'
   AND COALESCE(lower(a.status), '') <> 'cancelado'
   AND NOT EXISTS (
     SELECT 1 FROM public.reservations AS r
      WHERE r.appointment_id = a.id
        AND r.status NOT IN ('Devolvido', 'Cancelado')
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.fleet_usage AS u
      WHERE u.appointment_id = a.id
        AND u.status NOT IN ('Devolvido', 'Devolvido com pendência', 'Cancelado')
   )
   AND (a.vehicle_id IS NULL OR EXISTS (
     SELECT 1 FROM public.fleet_usage AS u
      WHERE u.appointment_id = a.id
        AND u.status IN ('Devolvido', 'Devolvido com pendência')
   ))
   AND (EXISTS (
     SELECT 1 FROM public.reservations AS r
      WHERE r.appointment_id = a.id AND r.status = 'Devolvido'
   ) OR EXISTS (
     SELECT 1 FROM public.fleet_usage AS u
      WHERE u.appointment_id = a.id
        AND u.status IN ('Devolvido', 'Devolvido com pendência')
   ));
