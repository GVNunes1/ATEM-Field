# Project: ATEM Field Supabase Migration & Backend Integration

## Architecture
- **Database Layer**: Remote PostgreSQL instance on Supabase project `aorclbawxpjgrbdrcith` (`https://aorclbawxpjgrbdrcith.supabase.co`).
- **Backend Service**: Express.js with TypeScript in `backend/src/server.ts` and `backend/src/routes/api.ts`.
- **Client Integration**: `@supabase/supabase-js` v2.112.3 client initialized in `backend/src/services/supabase.ts` using `SUPABASE_SERVICE_ROLE_KEY`.
- **Type Layer**: Auto-generated `database.types.ts` in `backend/src/types/database.types.ts` providing full TypeScript safety for Supabase database tables.
- **Migration & Seeding**: SQL migration scripts executed via Supabase SQL runner / MCP tools and Node migration script executing idempotent bulk inserts from `backend/data/db.json`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Supabase Relational Schema | 9 SQL tables (`technicians`, `appointments`, `appointment_technicians`, `equipment_categories`, `test_templates`, `analyzers`, `reservations`, `appointment_equipments`, `notification_logs`), PKs, FKs, indexes, RLS policies | M1 | R1 |
| 2 | Real Data Migration | 100% real data migration from `db.json`: 1,982 appointments, 120 technicians, 7 equipment categories, 5 test templates, 6 analyzers, 1,982 appointment equipments, 2,437 junction rows | M2 | R2 |
| 3 | TypeScript Database Types | Generated `database.types.ts` and integrated `createClient<Database>` in `backend/src/services/supabase.ts` | M3 | R3 |
| 4 | Backend REST API Refactoring | Refactor `/api/appointments`, `/api/technicians`, `/api/analyzers`, `/api/dashboard/stats`, `/api/categories`, `/api/reservations` endpoints to query Supabase directly | M4 | R3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Relational Schema DDL & Supabase Migration | Apply PostgreSQL schema for all 9 tables on Supabase using execute_sql / apply_migration | none | DONE |
| 2 | M2: Real Data Migration (100% db.json) | Migrate 1,982 appointments, 120 technicians, categories 1..7, templates, analyzers, appointment_equipments, and 2,437 appointment_technicians junction rows | M1 | DONE |
| 3 | M3: Database Types & Client Integration | Generate `database.types.ts` and configure `supabaseAdmin` client in `backend/src/services/supabase.ts` | M1 | DONE |
| 4 | M4: Express Backend API Refactoring | Refactor `backend/src/routes/api.ts` endpoints to serve data directly from Supabase, verifying builds and API responses | M2, M3 | IN_PROGRESS |

## Interface Contracts
### Express Backend ↔ Supabase Client
- `supabaseAdmin` exported from `backend/src/services/supabase.ts` configured with `SUPABASE_SERVICE_ROLE_KEY` and `<Database>` generic type.
- `database.types.ts` located at `backend/src/types/database.types.ts`.

### API REST Endpoint Specs
- `GET /api/dashboard/stats`: Returns `{ success: true, stats: { totalAnalyzers, availableAnalyzers, reservedAnalyzers, activeTechnicians, todayAppointments, recentReservations } }`.
- `GET /api/technicians`: Returns array of 120 technician objects (`id`, `name`, `phone`, `telegram_id`, `email`, `role`, `status`, `created_at`).
- `GET /api/analyzers`: Returns array of analyzer objects with current active reservation data.
- `GET /api/appointments`: Returns array of appointment objects with nested equipment categories and assigned technicians.

## Code Layout
- `backend/src/services/supabase.ts` - Supabase client configuration
- `backend/src/types/database.types.ts` - Generated TypeScript database types
- `backend/src/routes/api.ts` - Express REST API routes using Supabase queries
- `backend/migrations/*.sql` - PostgreSQL migration SQL DDL files
