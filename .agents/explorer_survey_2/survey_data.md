# Comprehensive Data Survey Report — ATEM Field (`db.json`)

**Date**: 2026-08-12  
**Explorer**: Explorer 2 (db.json & Data Structure Explorer)  
**Target File**: `backend/data/db.json` (Size: 1,662,217 bytes / ~1.66 MB)  

---

## Executive Summary

An exhaustive, field-by-field examination of `backend/data/db.json` was conducted. All data collections, primary keys, foreign key references, field types, nullability, and anomalies were parsed and validated against the system requirement specs and backend code (`backend/src/db/database.ts` and `backend/src/routes/api.ts`).

### Quick Count Matrix
| Collection Name | Target Count | Actual Count | Match Status | Notes |
| :--- | :---: | :---: | :---: | :--- |
| **`appointments`** | 1,982 | **1,982** | ✅ Exact Match | Real data imported from Google Calendar |
| **`technicians`** | 120 | **120** | ✅ Exact Match | All cataloged real field technicians |
| **`equipment_categories`** | 5-7 | **5** | ⚠️ Anomaly | `db.json` has 5 categories, but 261 equipment records reference category_id 6 and 7 |
| **`test_templates`** | 5 | **5** | ✅ Exact Match | Presets for analyzers / equipment testing |
| **`analyzers`** | 6 | **6** | ✅ Exact Match | Patrimônio format `PAT-XXXXXX` 100% compliant |
| **`reservations`** | 0 (Dynamic) | **0** | ✅ Exact Match | Checkout/checkin table (starts empty) |
| **`appointment_equipments`**| N/A | **1,982** | ✅ 1:1 Match | Maps 1:1 with `appointments` |
| **`notification_logs`** | N/A | **0** | ✅ Exact Match | Telegram notification history (starts empty) |

---

## 1. Collection-by-Collection Schema Breakdown

### 1.1 `technicians` (120 Records)
- **Primary Key**: `id` (`INTEGER`, Unique, 1..120)
- **Foreign Keys**: None (Referenced by `appointments` and `appointment_technicians`)
- **Fields & Types**:
  - `id` (`number`, 100% present, non-null): Unique technician ID.
  - `name` (`string`, 100% present, non-null): Technician first/full name (e.g., "Mateus", "Mauro", "Guilherme", "Fábio", "Hélio", "Christopher").
  - `phone` (`string`, 100% present): Placeholder value `"Pendente (Cadastrar via Telegram)"` across all 120 records.
  - `telegram_id` (`null`, 100% null): `null` across all 120 records (awaiting Telegram bot registration).
  - `email` (`string`, 100% present): Placeholder value `"Pendente"` across all 120 records.
  - `role` (`string`, 100% present): `"Técnico de Campo"` for all records.
  - `status` (`string`, 100% present): `"Ativo"` for all records.

### 1.2 `equipment_categories` (5 Records in JSON)
- **Primary Key**: `id` (`INTEGER`, Unique, 1..5)
- **Foreign Keys**: None (Referenced by `test_templates` and `appointment_equipments`)
- **Fields & Types**:
  - `id` (`number`, 1..5): Category ID.
  - `name` (`string`): Name of the category.
  - `description` (`string`): Detailed description.
- **Existing Records**:
  1. `Desfibrilador / Cardioversor` — Desfibriladores bipásicos, DEA e cardioversores de emergência e UTI
  2. `Monitor Multiparamétrico` — Monitores de sinais vitais (ECG, SpO2, NIBP, Temp, Capnografia)
  3. `Ventilador Pulmonar` — Ventiladores de UTI e Transporte de alta complexidade
  4. `Bomba de Infusão` — Bombas peristálticas de infusão contínua e seringa
  5. `Ultrassom Diagnóstico` — Sistemas de ultrassonografia geral, cardio e vascular
- *Data Anomaly Alert*: Categories 6 (`Autoclave / Esterilização`) and 7 (`Bisturi Eletrônico`) are present in `database.ts` fallback code and referenced by `appointment_equipments`, but missing from `db.json`.

### 1.3 `test_templates` (5 Records)
- **Primary Key**: `id` (`INTEGER`, Unique, 1..5)
- **Foreign Keys**: `category_id` -> `equipment_categories.id`
- **Fields & Types**:
  - `id` (`number`, 1..5): Template ID.
  - `category_id` (`number`, FK): Category reference (Values 1..4).
  - `analyzer_type` (`string`): Type of analyzer required (e.g., "Analisador de Desfibrilador", "Simulador de Sinais Vitais (Multiparamétrico)").
  - `required_parameters` (`string`): JSON stringified array of test parameters (e.g. `'["Energia de Choque Selecionada vs Entregue (Joules)", ...]'`).
  - `is_mandatory` (`number`): `1` (Boolean indicator).

### 1.4 `analyzers` (6 Records)
- **Primary Key**: `id` (`INTEGER`, Unique, 1..6)
- **Alternate Key / Unique Tag**: `asset_tag` (`string`, Format `PAT-XXXXXX`)
- **Foreign Keys**: None directly in JSON (Referenced by `reservations.analyzer_id`)
- **Fields & Types**:
  - `id` (`number`, 1..6): Analyzer ID.
  - `asset_tag` (`string`, `PAT-XXXXXX`): Unique asset identifier.
    - `PAT-104050`: Analisador de Desfibrilador Fluke Impulse 7000DP
    - `PAT-104051`: Analisador de Desfibrilador Rigel Uni-Pulse
    - `PAT-208012`: Simulador Patient Simulator ProSim 8
    - `PAT-208013`: Simulador de Sinais Vitais MPS4
    - `PAT-309100`: Analisador de Segurança Elétrica Rigel SafeTest 99
    - `PAT-401055`: Analisador de Fluxo Ventilatório VT650
  - `name` (`string`): Full equipment name.
  - `type` (`string`): Category/type matching `test_templates.analyzer_type`.
  - `serial_number` (`string`): Manufacturer serial number (e.g. `SN-FLK700921`).
  - `brand_model` (`string`): Manufacturer brand and model.
  - `status` (`string`): `"Disponível"` (5 records) or `"Em Uso"` (1 record, ID 3).
  - `calibration_date` (`string`, ISO Date `YYYY-MM-DD`).
  - `calibration_expiry` (`string`, ISO Date `YYYY-MM-DD`).
  - `current_location` (`string`): Location (e.g., "Maleta Central / Almoxarifado").
  - `notes` (`string`): Technical notes and calibration details.

### 1.5 `appointments` (1,982 Records)
- **Primary Key**: `id` (`INTEGER`, Unique, 1..1982)
- **Foreign Keys**:
  - `technician_id` -> `technicians.id` (Nullable integer: 1,733 non-null, 249 null)
  - `technician_ids` -> Array of `technicians.id` (N:N relationship)
- **Fields & Types**:
  - `id` (`number`): Appointment ID (1..1982).
  - `external_id` (`string`): Google Calendar Event ID (e.g. `GGCAL-eoctd6qofiujv68gl3br2dr7a8`).
  - `title` (`string`): Service order / Client summary.
  - `client_name` (`string`): Client name (derived from title/calendar event).
  - `client_address` (`string`): Address / Location.
  - `client_contact` (`string`): `"Sincronizado da Agenda Online"` for all 1,982 records.
  - `technician_id` (`number | null`): Primary technician ID (null when unassigned or multi-assigned).
  - `technician_ids` (`array of numbers`): List of assigned technician IDs (e.g., `[]`, `[1]`, `[2, 3]`).
  - `technician_names` (`string`): Formatted name string (e.g. `"Mateus"`, `"Guilherme, Christopher"`, `"Equipe de Campo"`).
  - `appointment_date` (`string`, `YYYY-MM-DD`).
  - `appointment_time` (`string`, `HH:mm`).
  - `status` (`string`): `"Agendado"` for all 1,982 records.
  - `created_at` (`string`, ISO 8601 Timestamp).

### 1.6 `appointment_equipments` (1,982 Records)
- **Primary Key**: `id` (`INTEGER`, Unique, 1..1982)
- **Foreign Keys**:
  - `appointment_id` -> `appointments.id` (100% 1:1 match with appointments 1..1982)
  - `category_id` -> `equipment_categories.id`
- **Fields & Types**:
  - `id` (`number`): 1..1982.
  - `appointment_id` (`number`): FK to `appointments.id`.
  - `category_id` (`number`): FK to `equipment_categories.id` (Values 1, 2, 3, 4, 6, 7).
  - `model` (`string`): Equipment model description.
  - `serial_number` (`string`): Serial tag (e.g., `S/N-REG-20250101`).
  - `tag` (`string`): Hospital asset tag (e.g., `PAT-HOSP-1`).
  - `sector` (`string`): Technical-assistance sector (`"Assistência Técnica"` for all records).

### 1.7 `reservations` (0 Records in JSON)
- **Primary Key**: `id` (`INTEGER`)
- **Foreign Keys**:
  - `appointment_id` -> `appointments.id`
  - `analyzer_id` -> `analyzers.id`
  - `technician_id` -> `technicians.id`
- **Expected Fields**: `id`, `appointment_id`, `analyzer_id`, `technician_id`, `reserved_date`, `status`, `checkout_at`, `checkin_at`, `notes`, `created_at`.

---

## 2. N:N Relationship Analysis (`appointments` <-> `technicians`)

In `db.json`, technician assignments are embedded directly inside `appointments` using `technician_ids` (JSON array). For SQL migration to Supabase PostgreSQL, this must be mapped to a junction table `appointment_technicians`.

### Breakdown of `technician_ids` Array Lengths across 1,982 Appointments:
- **0 Technicians (`[]` / Unassigned / "Equipe de Campo")**: 249 appointments
- **1 Technician (`[X]`)**: 1,079 appointments
- **2 Technicians (`[X, Y]`)**: 555 appointments
- **3 Technicians (`[X, Y, Z]`)**: 79 appointments
- **4 Technicians**: 15 appointments
- **5 Technicians**: 1 appointment
- **6 Technicians**: 1 appointment
- **21 Technicians**: 3 appointments

**Total Junction Rows to insert into `appointment_technicians`**: **2,437 rows**.  
**Referential Integrity**: 100% of the technician IDs inside `technician_ids` arrays exist in the `technicians` table (0 orphan technician IDs).

---

## 3. Critical Data Anomalies & SQL Migration Risks

### Anomaly #1: Missing Foreign Key Categories (Category IDs 6 & 7)
- **Observation**: `appointment_equipments` contains 261 records referencing `category_id = 6` (237 records) and `category_id = 7` (24 records). However, `db.json` `equipment_categories` list only has categories 1 through 5.
- **Root Cause**: In `backend/src/db/database.ts`, default category initialization includes categories 1 to 7 (`6: Autoclave / Esterilização`, `7: Bisturi Eletrônico`). However, `db.json` was saved prior to category seed completion or truncated.
- **Migration Impact**: Executing `INSERT INTO appointment_equipments` with a foreign key constraint to `equipment_categories(id)` will fail with a **Foreign Key Violation Error**.
- **Action Required**: The Supabase migration/seed script MUST populate `equipment_categories` with categories 1 through 7 before inserting `appointment_equipments`.

### Anomaly #2: `test_templates.required_parameters` Format
- **Observation**: `required_parameters` is stored as a stringified JSON array (e.g. `'["Energia de Choque Selecionada vs Entregue (Joules)", ...]'`).
- **Migration Impact**: Reading raw strings without JSON parsing causes frontend display errors or requires custom unmarshalling in backend API handlers.
- **Action Required**: Use PostgreSQL `JSONB` data type (or native PostgreSQL text array `TEXT[]`) in Supabase schema.

### Anomaly #3: Placeholder Technician Contact Information
- **Observation**: 100% of the 120 technicians have `phone = "Pendente (Cadastrar via Telegram)"`, `email = "Pendente"`, and `telegram_id = null`.
- **Migration Impact**: Unique constraints on `phone` or `email` would immediately fail on the 2nd row import due to duplicate `"Pendente"` strings.
- **Action Required**: Do NOT place `UNIQUE` constraints on `phone` or `email` columns in the `technicians` PostgreSQL table unless nulls/placeholders are handled. Allow nullable or non-unique text fields.

---

## 4. Summary Table for Database Migration Planning

| Supabase Table Name | Source Key in `db.json` | Record Count | Primary Key | Foreign Keys / Junctions |
| :--- | :--- | :---: | :--- | :--- |
| `technicians` | `technicians` | 120 | `id SERIAL` | None |
| `equipment_categories` | `equipment_categories` | 5 (Expand to 7) | `id SERIAL` | None |
| `test_templates` | `test_templates` | 5 | `id SERIAL` | `category_id -> equipment_categories(id)` |
| `analyzers` | `analyzers` | 6 | `id SERIAL` | None |
| `appointments` | `appointments` | 1,982 | `id SERIAL` | `technician_id -> technicians(id)` (nullable) |
| `appointment_equipments` | `appointment_equipments` | 1,982 | `id SERIAL` | `appointment_id -> appointments(id)`, `category_id -> equipment_categories(id)` |
| `appointment_technicians` | `appointments.technician_ids` | 2,437 | `id SERIAL` | `appointment_id -> appointments(id)`, `technician_id -> technicians(id)` |
| `reservations` | `reservations` | 0 | `id SERIAL` | `appointment_id -> appointments(id)`, `analyzer_id -> analyzers(id)`, `technician_id -> technicians(id)` |
| `notification_logs` | `notification_logs` | 0 | `id SERIAL` | `technician_id -> technicians(id)`, `appointment_id -> appointments(id)` |
