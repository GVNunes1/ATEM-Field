# Comprehensive Codebase & Backend Architecture Survey Report

**Date**: 2026-08-12  
**Target Project**: ATEM Field Platform (`quick-turing`)  
**Explorer Agent**: Explorer 1 (Codebase & Backend Architecture Explorer)  

---

## 1. Executive Summary

This report documents the architectural state, file structure, API routes, database access patterns, TypeScript configuration, build/test scripts, and dependency setup of the ATEM Field Platform backend (`quick-turing`).

Key Highlights:
- **Backend Stack**: Express v4.21.2, TypeScript v5.7.2 (ES2022, CommonJS target), Node.js.
- **Database Access Pattern**: Currently uses an in-memory JSON database (`store` object initialized from and saved to `backend/data/db.json`).
- **Supabase Status**: `@supabase/supabase-js` v2.112.3 is already installed as a dependency in both backend and frontend. `backend/src/services/supabase.ts` exposes `supabase` and `supabaseAdmin` clients.
- **Build Status**: `npm run build` (`tsc`) compiles cleanly with zero errors.
- **Test Status**: No test runner (Jest, Vitest, Mocha, etc.) or test scripts (`"test"`) exist in `package.json`.
- **Dataset in db.json**:
  - `technicians`: 120 authentic records
  - `appointments`: 1,982 authentic records (Google Calendar import)
  - `appointment_equipments`: 1,982 records
  - `equipment_categories`: 5 categories
  - `test_templates`: 5 templates
  - `analyzers`: 6 equipment units (Patrimônios PAT-104050, PAT-104051, PAT-208012, PAT-208013, PAT-309100, PAT-401055)
  - `reservations`: 0 records
  - `notification_logs`: 0 records

---

## 2. Directory Structure & Source File Listing

```
quick-turing/
├── backend/
│   ├── package.json               # Backend dependencies and scripts
│   ├── tsconfig.json              # TypeScript compiler configuration
│   ├── data/
│   │   └── db.json                # Local JSON store (53,335 lines, ~1.66 MB)
│   ├── dist/                      # Compiled JS output (dist/server.js, etc.)
│   └── src/
│       ├── server.ts              # Express application entry point
│       ├── db/
│       │   └── database.ts        # In-memory store + file I/O operations
│       ├── routes/
│       │   └── api.ts             # REST API endpoint definitions (709 lines)
│       └── services/
│           ├── supabase.ts        # Supabase JS Client initialization
│           ├── cronNotifier.ts    # Cron scheduler (node-cron) for daily alerts
│           ├── telegramBot.ts     # Notification formatter & logger
│           ├── import_agenda.py   # Python Google Calendar sync script
│           ├── google_auth_flow.py # Python OAuth flow helper
│           ├── google_oauth_server.py # Python local server for OAuth
│           ├── generate_google_auth.py # Token generator
│           └── reauth_google.py   # Re-authentication helper
├── frontend/
│   ├── package.json               # Frontend React + Vite setup
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx                # Main UI shell fetching /api endpoints
│       └── lib/
│           └── supabase.ts        # Frontend Supabase client initialization
├── ORIGINAL_REQUEST.md            # User requirements
└── .agents/                       # Agent metadata & handoffs
```

---

## 3. Express App Configuration & API Endpoints

### 3.1 Server Configuration (`backend/src/server.ts`)
- **Port**: `process.env.PORT || 3001`
- **Middleware**: `cors()`, `express.json()`
- **Lifecycle**:
  1. Calls `initDatabase()` from `src/db/database.ts` (loads `db.json` into memory or populates default categories/analyzers if empty).
  2. Calls `setupCronJobs()` from `src/services/cronNotifier.ts` (schedules 17:00 PREP and 07:00 MORNING alerts).
  3. Mounts `/api` router (`src/routes/api.ts`).
  4. Exposes `/health` endpoint returning `{ status: 'ok', timestamp: ... }`.
  5. Serves static frontend build from `../../frontend/dist`.

### 3.2 Key API Endpoints & Current Data Access

| Endpoint Path | HTTP Method | Handler Location | Current Data Fetching Mechanism | Description |
|---|---|---|---|---|
| `/api/dashboard/stats` | GET | `api.ts:13` | Calculates counts directly from `db.analyzers`, `db.appointments`, `db.technicians`, `db.reservations` in memory. | Returns counts for total/available/reserved analyzers, today's appointments, active techs, pending reservations, and 5 recent reservations. |
| `/api/appointments` | GET | `api.ts:403` | Filters `db.appointments` array by `date` or `technician_id` query params. Enriches items with `appointment_equipments` and `reservations`. | Lists appointments with assigned technicians, target hospital equipment, and reserved analyzer patrimônios. |
| `/api/appointments/:id/checklist` | GET | `api.ts:458` | Queries `db.appointments`, `db.appointment_equipments`, matching `db.test_templates`, and available `db.analyzers`. | Detailed checklist payload for a specific appointment, required test parameters, and matching available analyzers. |
| `/api/technicians` | GET | `api.ts:243` | Returns `db.technicians` array. | Lists registered technicians. |
| `/api/technicians` | POST | `api.ts:252` | Pushes new technician to `db.technicians` and calls `saveDB()`. | Registers a new field technician. |
| `/api/analyzers` | GET | `api.ts:336` | Maps over `db.analyzers`, attaches `current_reservation` from `db.reservations`. | Lists all analyzer patrimônios and their current status ('Disponível', 'Reservado', 'Em Uso'). |
| `/api/analyzers` | POST | `api.ts:363` | Validates duplicate `asset_tag`, pushes to `db.analyzers` and calls `saveDB()`. | Adds a new analyzer unit to inventory. |
| `/api/categories` | GET | `api.ts:285` | Maps `db.equipment_categories` with child `db.test_templates`. | Lists categories and test templates. |
| `/api/categories/templates` | POST | `api.ts:307` | Adds new template to `db.test_templates` and calls `saveDB()`. | Creates a new test template. |
| `/api/reservations` | GET | `api.ts:532` | Enriches `db.reservations` with analyzer, technician, and appointment details. | Lists analyzer reservations. |
| `/api/reservations` | POST | `api.ts:558` | Checks analyzer availability, pushes reservation, sets analyzer status to `'Reservado'`, calls `saveDB()`. | Reserves an analyzer for an appointment. |
| `/api/reservations/:id/checkout` | POST | `api.ts:620` | Sets reservation & analyzer status to `'Em Uso'`, calls `saveDB()`. | Registers analyzer checkout (retirada). |
| `/api/reservations/:id/checkin` | POST | `api.ts:642` | Sets reservation status to `'Devolvido'`, analyzer status to `'Disponível'`, calls `saveDB()`. | Registers analyzer check-in (devolução). |
| `/api/sync/agenda-online` | POST | `api.ts:64` | Executes `import_agenda.py` via `child_process.exec`, parses stdout JSON, replaces `db.appointments` and `db.technicians` with fresh data, calls `saveDB()`. | Imports 100% real Google Calendar appointments & technicians. |
| `/api/notifications/trigger` | POST | `api.ts:667` | Triggers Telegram notification for a technician via `sendTechnicianNotification()`. | Triggers notification log entry. |
| `/api/notifications/logs` | GET | `api.ts:687` | Returns recent items from `db.notification_logs`. | Returns notification dispatch history. |

---

## 4. Build, Scripts, and Test Runner Verification

### 4.1 `backend/package.json` Scripts
```json
"scripts": {
  "build": "tsc",
  "start": "node dist/server.js",
  "dev": "ts-node-dev --respawn --transpile-only src/server.ts"
}
```

### 4.2 Build Verification
- Running `npm run build` (or `npm.cmd run build` on Windows) executes `tsc` using `backend/tsconfig.json`.
- **Result**: Successfully compiled to `./dist` with zero errors.

### 4.3 Test Runner Status
- **Test Command**: No `"test"` script is present in `package.json`.
- **Dependencies**: No test framework (`jest`, `vitest`, `mocha`, `ts-jest`, `supertest`) is installed.
- **Test Files**: No `.test.ts` or `.spec.ts` files exist in the project.

---

## 5. Supabase Client & Dependencies

### 5.1 Package Dependencies
`@supabase/supabase-js` v2.112.3 is installed in both `backend/package.json` and `frontend/package.json`.

### 5.2 Supabase Client Setup (`backend/src/services/supabase.ts`)
```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://aorclbawxpjgrbdrcith.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Cliente público / anon
export const supabase = createClient(supabaseUrl, supabaseAnonKey || 'dummy-key-for-init');

// Cliente Admin (Service Role - bypassa RLS para operações seguras de backend)
export const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : supabase;
```

---

## 6. Environment Variables Setup

The backend utilizes `dotenv` (`require('dotenv').config()` can be used or environment variables passed via process environment).
Key environment variables referenced in code:
- `PORT`: Server listening port (default: `3001`).
- `SUPABASE_URL`: Target Supabase project URL (default fallback: `https://aorclbawxpjgrbdrcith.supabase.co`).
- `SUPABASE_ANON_KEY`: Public anonymous key for Supabase client.
- `SUPABASE_SERVICE_ROLE_KEY`: Service role secret key for backend admin operations (bypasses RLS).

---

## 7. Data Models & `db.json` Dataset Breakdown

| Model / Table | `db.json` Field | Record Count | Description & Primary Fields |
|---|---|---|---|
| Technicians | `technicians` | 120 | `id`, `name`, `phone`, `telegram_id`, `email`, `role`, `avatar_url`, `status`, `created_at` |
| Appointments | `appointments` | 1,982 | `id`, `external_id` (`GGCAL-...`), `title`, `client_name`, `client_address`, `client_contact`, `technician_id`, `technician_ids`, `technician_names`, `appointment_date`, `appointment_time`, `status`, `created_at` |
| Appointment Equipments | `appointment_equipments` | 1,982 | `id`, `appointment_id`, `category_id`, `model`, `serial_number`, `tag`, `sector` |
| Equipment Categories | `equipment_categories` | 5 | `id`, `name`, `description` (1: Desfibrilador, 2: Monitor Multiparamétrico, 3: Ventilador Pulmonar, 4: Bomba de Infusão, 5: Ultrassom Diagnóstico) |
| Test Templates | `test_templates` | 5 | `id`, `category_id`, `analyzer_type`, `required_parameters` (JSON string array), `is_mandatory` |
| Analyzers | `analyzers` | 6 | `id`, `asset_tag` (`PAT-104050`, `PAT-104051`, `PAT-208012`, `PAT-208013`, `PAT-309100`, `PAT-401055`), `name`, `type`, `serial_number`, `brand_model`, `status`, `calibration_date`, `calibration_expiry`, `current_location`, `notes` |
| Reservations | `reservations` | 0 | `id`, `appointment_id`, `analyzer_id`, `technician_id`, `reserved_date`, `status`, `checkout_at`, `checkin_at`, `notes`, `created_at` |
| Notification Logs | `notification_logs` | 0 | `id`, `technician_id`, `appointment_id`, `type`, `sent_at`, `message`, `status` |

---

## 8. Conclusions & Handoff Readiness

The codebase is cleanly structured, uses modern TypeScript, and has all required packages (`@supabase/supabase-js`) installed. The current backend architecture uses in-memory reads/writes backed by `backend/data/db.json`.

To complete the Supabase migration requirement specified in `ORIGINAL_REQUEST.md`:
1. SQL relational schema migrations should be designed and applied to Supabase matching the 7 main tables (`technicians`, `appointments`, `appointment_technicians`, `equipment_categories`, `test_templates`, `analyzers`, `reservations`).
2. Data from `backend/data/db.json` (120 technicians, 1982 appointments, 1982 appointment equipments, categories, templates, analyzers) must be imported into Supabase.
3. TypeScript database types (`database.types.ts`) should be generated.
4. Express API endpoints in `backend/src/routes/api.ts` should be updated to query `supabase` / `supabaseAdmin` instead of `getDB()` / `saveDB()`.

Report compiled and ready for parent agent review.
