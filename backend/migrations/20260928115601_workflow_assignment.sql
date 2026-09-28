-- Workflow owner belongs to a current ATEM user profile, not a free-text name.
-- Only the backend service role writes assignments; the public Data API keeps
-- the new columns private. Existing appointments remain unassigned until handed off.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS workflow_assignee_id BIGINT REFERENCES public.technicians(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS workflow_assigned_by TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_workflow_assignee
  ON public.appointments (workflow_assignee_id, workflow_status, appointment_date)
  WHERE workflow_assignee_id IS NOT NULL;

REVOKE SELECT (workflow_assignee_id, workflow_assigned_at, workflow_assigned_by),
  UPDATE (workflow_assignee_id, workflow_assigned_at, workflow_assigned_by)
  ON public.appointments FROM PUBLIC, anon, authenticated;
