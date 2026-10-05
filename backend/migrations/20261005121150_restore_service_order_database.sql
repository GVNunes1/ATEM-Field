-- Applied to aorclbawxpjgrbdrcith via Supabase MCP; timestamp from migration history.
create table public.service_orders (
 id text primary key,
 os_number text,
 status text not null default 'unsigned' check (status in ('unsigned', 'signed')),
 client_name text,
 serial_number text,
 equipment_name text,
 technician_name text,
 service_date text,
 form_data jsonb not null default '{}'::jsonb check (jsonb_typeof(form_data) = 'object'),
 pdf_filename text,
 pdf_url text,
 drive_file_id text unique,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index service_orders_created_at_idx on public.service_orders (created_at desc);
create table public.equipments (
 id text primary key default gen_random_uuid()::text,
 serial_number text not null check (btrim(serial_number) <> ''),
 equipment text,
 brand text,
 model text,
 tag text,
 client text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index equipments_serial_number_search_idx on public.equipments using gin (serial_number public.gin_trgm_ops);
alter table public.service_orders enable row level security;
alter table public.equipments enable row level security;
revoke all on public.service_orders, public.equipments from public, anon, authenticated;
grant select, insert, update, delete on public.service_orders, public.equipments to service_role;
comment on table public.service_orders is 'ATEM OS metadata. Backend JWT authorization only; original PDFs remain in Google Drive.';
comment on column public.service_orders.drive_file_id is 'Stable recovery identity; one history record per original Drive PDF.';
notify pgrst, 'reload schema';
