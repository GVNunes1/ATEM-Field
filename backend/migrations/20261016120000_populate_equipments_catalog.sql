-- Migration: 20261016120000_populate_equipments_catalog.sql
-- Description: Ensure unique constraint on serial_number and populate equipments catalog from appointment_equipments and service_orders

ALTER TABLE public.equipments ADD CONSTRAINT equipments_serial_number_unique UNIQUE (serial_number);

-- 1. Populate from appointment_equipments
INSERT INTO public.equipments (serial_number, equipment, model, tag, client)
SELECT 
  btrim(ae.serial_number) AS serial_number,
  max(coalesce(ec.name, 'Equipamento')) AS equipment,
  max(ae.model) AS model,
  max(ae.tag) AS tag,
  max(a.client_name) AS client
FROM public.appointment_equipments ae
LEFT JOIN public.appointments a ON ae.appointment_id = a.id
LEFT JOIN public.equipment_categories ec ON ae.category_id = ec.id
WHERE ae.serial_number IS NOT NULL AND btrim(ae.serial_number) <> ''
GROUP BY btrim(ae.serial_number)
ON CONFLICT (serial_number) DO NOTHING;

-- 2. Populate and update from service_orders (more granular brand/equipment/tag)
INSERT INTO public.equipments (serial_number, equipment, brand, model, tag, client)
SELECT 
  btrim(serial_number) AS serial_number,
  max(equipment_name) AS equipment,
  max(form_data->>'Marca') AS brand,
  max(form_data->>'Modelo') AS model,
  max(form_data->>'Patrimonio') AS tag,
  max(client_name) AS client
FROM public.service_orders
WHERE serial_number IS NOT NULL AND btrim(serial_number) <> ''
GROUP BY btrim(serial_number)
ON CONFLICT (serial_number) DO UPDATE SET
  equipment = coalesce(nullif(excluded.equipment, ''), public.equipments.equipment),
  brand = coalesce(nullif(excluded.brand, ''), public.equipments.brand),
  model = coalesce(nullif(excluded.model, ''), public.equipments.model),
  tag = coalesce(nullif(excluded.tag, ''), public.equipments.tag),
  client = coalesce(nullif(excluded.client, ''), public.equipments.client),
  updated_at = now();
