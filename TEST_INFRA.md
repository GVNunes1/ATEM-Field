# ATEM Field E2E Testing Infrastructure (`TEST_INFRA.md`)

## Overview

The ATEM Field End-to-End (E2E) Test Infrastructure provides a comprehensive, requirement-driven test framework designed to validate REST API endpoints, database schemas, boundary conditions, cross-feature integrations, and real-world technician workflows.

---

## File Architecture & Organization

```
quick-turing/
├── package.json                         # Root NPM configuration with "test:e2e" script
└── backend/
    ├── package.json                     # Backend NPM package configuration
    └── tests/
        ├── e2e_runner.js                # Master CLI test runner & reporter
        ├── helpers.js                   # Server lifecycle manager, HTTP fetch & assertions
        ├── tier1_coverage.test.js       # Tier 1: Feature & Data Coverage tests
        ├── tier2_boundary.test.js       # Tier 2: Boundary & Edge Case tests
        ├── tier3_combinations.test.js   # Tier 3: Cross-Feature Integration tests
        └── tier4_workflow.test.js       # Tier 4: Real-World E2E Application Workflow tests
```

---

## Key Infrastructure Capabilities

1. **Automatic Server Lifecycle Management**:
   - The test runner (`helpers.js` / `e2e_runner.js`) automatically inspects whether the Express backend is active on `http://127.0.0.1:3001/health`.
   - If not running, it automatically compiles TypeScript (`npm.cmd run build`), spawns `node dist/server.js`, and polls `/health` until ready.
   - Upon completion of all test tiers, it gracefully terminates any server process it spawned, avoiding orphan processes.

2. **Supabase & REST API Dual Access Verification**:
   - Integrates `@supabase/supabase-js` client to test direct PostgreSQL table & schema accessibility.
   - Tests REST endpoints (`/api/dashboard/stats`, `/api/technicians`, `/api/analyzers`, `/api/appointments`, `/api/reservations`, `/api/appointments/:id/checklist`).

3. **Strict Exit Code Contract**:
   - Returns **exit code 0** on 100% test pass.
   - Returns **exit code 1** on any test assertion or environment failure.

---

## Execution Commands

### Workspace Root:
```bash
node backend/tests/e2e_runner.js
# or
npm.cmd run test:e2e
```

### Backend Directory (`backend/`):
```bash
node tests/e2e_runner.js
# or
npm.cmd run test:e2e
```
