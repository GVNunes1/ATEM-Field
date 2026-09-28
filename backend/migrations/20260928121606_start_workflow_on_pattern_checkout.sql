-- A physical checkout starts a confirmed appointment exactly once. This runs
-- in the reservation update transaction, so checkout and workflow cannot
-- diverge after a partial API failure.
CREATE OR REPLACE FUNCTION public.start_workflow_on_pattern_checkout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Reservation changes made outside the backend service must not advance
  -- appointments through the public Data API.
  IF current_user <> 'service_role'
     OR NEW.appointment_id IS NULL
     OR NEW.technician_id IS NULL
     OR COALESCE(NEW.operation_type, 'Atendimento') <> 'Atendimento' THEN
    RETURN NEW;
  END IF;

  UPDATE public.appointments AS a
     SET workflow_status = 'Em execução',
         last_activity_at = COALESCE(NEW.checkout_at, now())
   WHERE a.id = NEW.appointment_id
     AND a.workflow_status = 'Confirmado com cliente'
     AND (
       a.technician_id = NEW.technician_id
       OR EXISTS (
         SELECT 1 FROM public.appointment_technicians AS at
          WHERE at.appointment_id = a.id
            AND at.technician_id = NEW.technician_id
       )
     );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_start_workflow_on_pattern_checkout ON public.reservations;
CREATE TRIGGER trg_start_workflow_on_pattern_checkout
AFTER UPDATE OF status ON public.reservations
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM 'Em Uso' AND NEW.status = 'Em Uso')
EXECUTE FUNCTION public.start_workflow_on_pattern_checkout();

REVOKE EXECUTE ON FUNCTION public.start_workflow_on_pattern_checkout() FROM PUBLIC, anon, authenticated;
