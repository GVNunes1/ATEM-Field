-- Application authentication uses backend JWTs, not the Supabase anonymous or
-- authenticated roles. All direct table access must pass through the API.
ALTER TABLE public.technicians ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;
DO $migration$
DECLARE
  target text;
  columns text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'technicians', 'app_credentials', 'appointments', 'appointment_technicians',
    'equipment_categories', 'test_templates', 'analyzers', 'reservations',
    'appointment_equipments', 'notification_logs'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', target);
    -- Table revocation does not revoke the column grants introduced by 003.
    SELECT string_agg(quote_ident(attname), ', ') INTO columns
      FROM pg_attribute WHERE attrelid = format('public.%I', target)::regclass
        AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated', columns, target);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
  END LOOP;
END
$migration$;

-- Atomic revocation covers the PIN login, existing JWT profile refresh and the
-- delegated portal. Failure rolls back both the account change and deletion.
CREATE OR REPLACE FUNCTION public.revoke_app_credential(credential_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  credential public.app_credentials%ROWTYPE;
BEGIN
  SELECT * INTO credential FROM public.app_credentials
    WHERE id = credential_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF credential.username = 'admin' THEN
    RAISE EXCEPTION 'O Administrador Master não pode ser excluído.' USING ERRCODE = '22023';
  END IF;
  IF credential.technician_id IS NOT NULL THEN
    UPDATE public.technicians SET status = 'Inativo', pin = NULL, auth_version = auth_version + 1
      WHERE id = credential.technician_id;
  END IF;
  DELETE FROM public.app_credentials WHERE id = credential_id;
END
$function$;
REVOKE ALL ON FUNCTION public.revoke_app_credential(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_app_credential(bigint) TO service_role;

-- Compare-and-set via POST RPC keeps the legacy secret out of request URLs and
-- prevents a startup migration from overwriting a concurrent PIN reset.
CREATE OR REPLACE FUNCTION public.upgrade_login_pin(target_table text, profile_id bigint, expected_pin text, hashed_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  changed integer;
BEGIN
  IF hashed_pin !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' THEN
    RAISE EXCEPTION 'Hash inválido.' USING ERRCODE = '22023';
  END IF;
  IF target_table = 'technicians' THEN
    UPDATE public.technicians SET pin = hashed_pin WHERE id = profile_id AND pin = expected_pin;
  ELSIF target_table = 'app_credentials' THEN
    UPDATE public.app_credentials SET pin = hashed_pin WHERE id = profile_id AND pin = expected_pin;
  ELSE
    RAISE EXCEPTION 'Tabela inválida.' USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'PIN alterado durante a migração. Reinicie e tente novamente.' USING ERRCODE = '40001';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.upgrade_login_pin(text,bigint,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_login_pin(text,bigint,text,text) TO service_role;
