## Phase 5 — Execution Report

### Fixes Applied — Review Round 1

- Issue: `COMPLETED` trusted settlements accepted an omitted `final_word_count`, stored `0`, and let `POST /v1/usage/finalize` create a zero-word finalized usage row without spending quota.
  - Confirmed: yes. I verified the bug in `src/modules/usage/service.ts`, where the settlement path only rejected `finalWordCount === null` and then used `?? 0`, and I reproduced the behavior through the live harness before fixing it.
  - What I fixed: tightened `UsageService.settleTrustedRealtimeSession(...)` so `COMPLETED` trusted settlements require explicit `finalWordCount`, `audioSeconds`, and `requestCount` values instead of silently defaulting omitted terminal metrics to `0`; finalized usage now reads from an explicit trusted snapshot and no longer falls back to `?? 0` for trusted billable fields.
  - How I verified: `npm run build` passed, `npx vitest run test/integration/usage.test.ts` passed with `10/10`, `npm run test` passed with `70/70`, and a direct in-process repro now returns `400 invalid_trusted_result`, leaves the session `OPEN` with all trusted fields still `null`, returns `409 trusted_usage_unavailable` from finalize, and creates no usage or quota rows.

- Issue: the Phase 5 integration suite missed malformed `COMPLETED` settlements because the test helper always auto-filled `finalWordCount`.
  - Confirmed: yes. I verified `test/integration/usage.test.ts` was using `overrides?.finalWordCount ?? 321`, so the suite could not intentionally omit the trusted terminal field that triggered the bug.
  - What I fixed: updated the helper to preserve intentionally omitted trusted fields and added explicit regressions for omitted `finalWordCount`, `audioSeconds`, and `requestCount`, each asserting the settlement is rejected, the session remains untrusted and `OPEN`, finalize stays blocked with `trusted_usage_unavailable`, and no usage/quota rows are written.
  - How I verified: the targeted usage suite now contains those negative cases and passes cleanly with `10/10` tests, while the full regression suite still passes with `70/70`.

### Summary

Phase 5 implemented the trusted usage and quota layer required by the final plan: server-owned realtime session creation, a real internal trusted-result settlement path, trusted finalize with actor-scoped idempotency, atomic weekly quota enforcement, telemetry-only usage events, and usage visibility reads. The Prisma schema now includes `realtime_sessions`, `quota_windows`, `usage_events`, and `usage_rollups_weekly`, the app now serves `POST /v1/realtime/session`, `POST /v1/usage/finalize`, `POST /v1/usage/events`, `GET /v1/usage/quota`, and `GET /v1/usage/summary`, and the test harness can drive the internal settlement path through real application service code. Verification passed across Prisma validation/generation/migration checks, seed, targeted Phase 5 integration tests, full build, full regression tests, and a representative smoke flow showing telemetry does not mutate quota.

### Step-by-Step Execution Log

- Step 1: Confirm the Phase 4 baseline and map the exact Phase 5 extension points
  - Action taken: Re-read `final_plan.md`, `project_status.md`, `phase_5/plan_approved.md`, and `phase_4/exec_report.md`; inspected the existing app, billing, entitlement, device, pagination, idempotency, and test-harness extension points.
  - Files modified: none.
  - Verification: `npm run build` passed; `npm run test` passed before Phase 5 edits with `14/14` files and `60/60` tests.
  - Status: DONE

- Step 2: Lock the trusted-usage contract and the full Phase 5 data model before editing the schema
  - Action taken: Mapped the exact locked Phase 5 behavior into code-facing rules before schema edits: trusted session creation, internal trusted settlement, finalize deriving billable truth only from session fields, telemetry isolation, and weekly rollup totals for words, audio seconds, and requests.
  - Files modified:
    - `src/modules/usage/schemas.ts`: request contracts for realtime session creation, finalize, telemetry, and quota reads.
    - `src/modules/usage/service.ts`: service contract enforcing trusted-result-only finalize and telemetry isolation.
    - `test/integration/usage.test.ts`: integration coverage aligned to the locked Phase 5 model.
  - Verification: Targeted design review against `final_plan.md` and `phase_5/plan_approved.md` before schema work; the later implementation and tests exercised every locked field required by the plan.
  - Status: DONE

- Step 3: Extend the Prisma schema for realtime sessions, quota windows, usage events, and weekly rollups
  - Action taken: Added `RealtimeSessionStatus` and `UsageEventStatus`, plus new Prisma models for `realtime_sessions`, `quota_windows`, `usage_events`, and `usage_rollups_weekly`, including the locked usage fields, relations, indexes, and uniqueness constraints.
  - Files modified:
    - `prisma/schema.prisma`: Phase 5 enums, models, relations, indexes, and composite uniqueness.
  - Verification: `npx prisma validate` succeeded after the schema change.
  - Status: DONE

- Step 4: Create, inspect, and apply the Phase 5 migration to dev and test databases
  - Action taken: Generated and applied the Phase 5 migration, then inspected the produced SQL and applied the same migration path to the test database.
  - Files modified:
    - `prisma/migrations/20260326113841_phase5_usage_and_quota/migration.sql`: generated migration for new enums, tables, indexes, and foreign keys.
  - Verification: `npx prisma migrate dev --name phase5_usage_and_quota` succeeded on `typetalk_dev`; `npx prisma migrate status` reported the dev schema was up to date; test-DB `npx prisma migrate deploy` succeeded.
  - Status: DONE_WITH_DEVIATION
  - Deviation: the approved plan said to inspect the SQL before applying it; `npx prisma migrate dev` generated and applied in one command, so I inspected `migration.sql` immediately after generation instead of before application. I then verified the resulting schema with `prisma migrate status`, test-DB deploy, build, and tests.

- Step 5: Scaffold the new `usage` module and register the Phase 5 routes in the app
  - Action taken: Created the new usage module files and wired them into `src/app.ts` under the existing authenticated `/v1` route surface.
  - Files modified:
    - `src/modules/usage/routes.ts`: public Phase 5 route registration.
    - `src/modules/usage/schemas.ts`: Zod schemas and payload mappers.
    - `src/modules/usage/repository.ts`: persistence primitives.
    - `src/modules/usage/service.ts`: business logic.
    - `src/app.ts`: usage service construction and route registration.
  - Verification: `npm run build` passed after the module was wired into the app.
  - Status: DONE

- Step 6: Add usage repository primitives and the UTC weekly-window helper
  - Action taken: Implemented repository methods for session creation and lookup, trusted settlement writes, quota row upsert/update, usage-event creation, weekly rollup upsert, and current-week reads; added a UTC Monday week-window helper.
  - Files modified:
    - `src/modules/usage/repository.ts`: Prisma-backed usage persistence layer.
    - `src/modules/usage/window.ts`: Monday 00:00 UTC week boundary helper.
  - Verification: Targeted usage tests later confirmed the helper and repository logic through finalize success, quota enforcement, telemetry isolation, and Monday rollover scenarios.
  - Status: DONE

- Step 7: Implement `POST /v1/realtime/session` as the server-owned session creation path
  - Action taken: Added authenticated realtime session creation with owned-device validation, required `feature_code` and `provider`, optional `provider_session_ref`, and no quota mutation.
  - Files modified:
    - `src/modules/usage/routes.ts`: `POST /v1/realtime/session`.
    - `src/modules/usage/service.ts`: owned-device enforcement and session serialization.
    - `src/modules/usage/schemas.ts`: realtime-session request schema.
  - Verification: `test/integration/usage.test.ts` covered successful creation and rejection of a foreign device; persisted rows showed correct org, user, device, provider, and open status; quota-window count remained `0`.
  - Status: DONE

- Step 8: Implement the real internal trusted-result settlement path for realtime sessions
  - Action taken: Added `UsageService.settleTrustedRealtimeSession(...)` as a real internal application path that writes trusted terminal session results onto `realtime_sessions`, rejects double settlement, rejects provider/provider-session mismatches, and marks stale sessions expired.
  - Files modified:
    - `src/modules/usage/service.ts`: internal trusted settlement path.
    - `src/modules/usage/repository.ts`: conditional trusted-result persistence updates.
    - `test/helpers/app.ts`: exposed `usageService` from the harness so tests and smoke flows use application service code instead of direct DB mutation.
  - Verification: The targeted suite exercised successful settlement, stored `provider_session_ref`, `status`, `ended_at`, `final_word_count`, `audio_seconds`, `request_count`, and `trusted_result_source`, and confirmed the second settlement attempt returns `realtime_session_already_settled`.
  - Status: DONE

- Step 9: Implement `POST /v1/usage/finalize` with actor-scoped idempotency and trusted-result enforcement
  - Action taken: Added authenticated finalize with mandatory `Idempotency-Key`, request hashing via the existing idempotency library, trusted-result-only billable usage derivation, rejection of missing/untrusted/consumed sessions, and replay/conflict behavior.
  - Files modified:
    - `src/modules/usage/routes.ts`: `POST /v1/usage/finalize`.
    - `src/modules/usage/service.ts`: finalize idempotency and trusted-result enforcement.
    - `src/modules/usage/schemas.ts`: finalize request schema.
  - Verification: Targeted tests confirmed:
    - finalize before settlement returns `409 trusted_usage_unavailable`
    - missing `Idempotency-Key` returns `400 missing_idempotency_key`
    - first finalize succeeds
    - replay with the same key returns the stored response
    - reusing the same key with a different payload returns `409 idempotency_key_conflict`
  - Status: DONE

- Step 10: Implement the atomic quota transaction, trusted usage event write, and weekly rollup update inside finalize
  - Action taken: Wrapped finalize in the existing serializable idempotent transaction, locked the user row, resolved the plan limit from `plans.weekly_word_limit`, computed the Monday UTC window from the trusted `ended_at`, rejected overages before any billable write, created one finalized `usage_event`, incremented `quota_windows`, and upserted weekly rollups.
  - Files modified:
    - `src/modules/usage/service.ts`: transaction orchestration, limit resolution, quota check, billable event write, rollup update.
    - `src/modules/usage/repository.ts`: quota-row upsert/increment and weekly rollup upsert.
  - Verification: Targeted tests covered successful finalize, overage rejection without partial writes, paid-plan limit behavior, Monday rollover, and a concurrency race where only one of two competing free-plan finalizes could spend.
  - Status: DONE

- Step 11: Implement `POST /v1/usage/events` as telemetry-only and keep it non-billable
  - Action taken: Added authenticated telemetry event recording with bounded metadata, device/session ownership validation, non-billable `TELEMETRY` status, and explicit separation from quota windows and trusted rollups.
  - Files modified:
    - `src/modules/usage/routes.ts`: `POST /v1/usage/events`.
    - `src/modules/usage/service.ts`: telemetry-only persistence path.
    - `src/modules/usage/schemas.ts`: telemetry request schema and bounded metadata handling.
  - Verification: Targeted tests showed telemetry rows persisted `provider`, `audio_seconds`, `request_count`, and metadata, while `GET /v1/usage/quota` and `GET /v1/usage/summary` remained unchanged after telemetry writes.
  - Status: DONE

- Step 12: Implement `GET /v1/usage/quota` and `GET /v1/usage/summary` on top of the full trusted data model
  - Action taken: Added quota and summary reads that resolve the current plan/entitlement context, report the active Monday UTC window, return current trusted usage totals, and exclude telemetry-only rows from the trusted summary.
  - Files modified:
    - `src/modules/usage/routes.ts`: `GET /v1/usage/quota` and `GET /v1/usage/summary`.
    - `src/modules/usage/service.ts`: read-side serialization for quota and summary.
  - Verification: Targeted tests covered free-plan reads, paid-plan reads sourced from the seeded `plans` table, and unchanged quota/summary after telemetry submissions.
  - Status: DONE

- Step 13: Extend the test harness and add focused Phase 5 integration coverage
  - Action taken: Extended the reset helper for new tables, exposed the real usage service through the test harness, and added a dedicated `usage.test.ts` suite covering session creation, internal trusted settlement, finalize behavior, quota exhaustion, paid limits, UTC rollover, telemetry isolation, field persistence, and concurrency safety.
  - Files modified:
    - `test/helpers/app.ts`: usage-service exposure for tests and smoke flows.
    - `test/helpers/db.ts`: truncation of Phase 5 tables.
    - `test/integration/usage.test.ts`: focused Phase 5 integration suite.
  - Verification: `npx vitest run test/integration/usage.test.ts` passed with `1/1` file and `7/7` tests.
  - Status: DONE

- Step 14: Run the full Phase 5 verification matrix and prepare the phase for execution review
  - Action taken: Ran Prisma validation/generation/migration checks, test-DB deploy, seed, build, targeted usage tests, the full regression suite, and a representative smoke flow that created a realtime session, settled a trusted result through the application service, finalized usage, read quota, read summary, submitted telemetry, and confirmed telemetry did not mutate quota.
  - Files modified:
    - `phase_5/exec_report.md`: this execution report.
  - Verification: All planned verification commands and the smoke flow passed; detailed outputs are included below.
  - Status: DONE

### Testing Results

```text
$ npx prisma validate
Prisma schema loaded from prisma\schema.prisma
The schema at prisma\schema.prisma is valid.
```

```text
$ npx prisma generate
Prisma schema loaded from prisma\schema.prisma
Generated Prisma Client (v6.19.2) to .\node_modules\@prisma\client in 312ms
```

```text
$ npx prisma migrate status
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "typetalk_dev", schema "public" at "127.0.0.1:55432"
6 migrations found in prisma/migrations
Database schema is up to date!
```

```text
$ test DB: npx prisma migrate deploy
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "typetalk_test", schema "public" at "127.0.0.1:55432"
6 migrations found in prisma/migrations
No pending migrations to apply.
```

```text
$ npx prisma db seed
Running seed command `tsx prisma/seed.ts` ...
The seed command has been executed.
```

```text
$ npm run build
> typetalk-backend@0.1.0 build
> tsc -p tsconfig.json
```

```text
$ npx vitest run test/integration/usage.test.ts
Test Files  1 passed (1)
Tests       10 passed (10)
Duration    15.50s
```

```text
$ npm run test
Test Files  15 passed (15)
Tests       70 passed (70)
Duration    107.32s
```

```json
{
  "settle_error": {
    "statusCode": 400,
    "code": "invalid_trusted_result",
    "message": "Completed trusted results require a final word count."
  },
  "session_status": "OPEN",
  "trusted_result_source": null,
  "ended_at": null,
  "final_word_count": null,
  "audio_seconds": null,
  "request_count": null,
  "finalize_status": 409,
  "finalize_error": "trusted_usage_unavailable",
  "usage_event_count": 0,
  "quota_window_count": 0
}
```

```json
{
  "sign_in_status": 200,
  "device_status": 200,
  "realtime_session_status": 201,
  "settled_status": "completed",
  "finalize_status": 200,
  "finalize_quota_used_words": 432,
  "summary_total_words": 432,
  "telemetry_status": 201,
  "quota_before_telemetry": 432,
  "quota_after_telemetry": 432
}
```

### Success Criteria Checklist

- [x] `realtime_sessions`, `quota_windows`, `usage_events`, and `usage_rollups_weekly` exist in Prisma and in both dev and test databases with the constraints needed for trusted usage enforcement.
- [x] The Phase 5 schema includes the locked usage fields needed for auditing and reporting: session `provider`, `provider_session_ref`, terminal `status`, `ended_at`, `final_word_count`, `trusted_result_source`, usage-event `provider`, `audio_seconds`, `request_count`, event `status`, and rollup totals for words, audio seconds, and requests.
- [x] `POST /v1/realtime/session` exists, requires auth, validates device ownership, and creates a server-owned realtime session without spending quota.
- [x] A real internal backend settlement path exists to write trusted terminal session results onto `realtime_sessions`, and finalize success depends on that runtime path rather than direct DB mutation.
- [x] `POST /v1/usage/finalize` exists, requires `Idempotency-Key`, rejects untrusted client-declared billable truth, and only succeeds when a trusted session result is already stored on the backend-owned session.
- [x] Finalize applies quota enforcement in one database transaction, derives limits from the seeded `plans.weekly_word_limit` field, uses Monday 00:00 UTC weekly windows, writes one trusted usage event, and updates weekly rollups for words, audio seconds, and request counts.
- [x] Repeating finalize with the same idempotency key does not double-spend quota or create duplicate billable usage rows.
- [x] `POST /v1/usage/events` remains telemetry-only and cannot mutate quota windows, trusted finalized session state, or billable rollups.
- [x] `GET /v1/usage/quota` and `GET /v1/usage/summary` return correct usage visibility for free and paid organizations, including total words, audio seconds, and request counts, without exposing raw transcript text, raw audio, or app context.
- [x] The targeted Phase 5 integration suite covers trusted settlement, finalize, quota exceeded behavior, UTC weekly-window behavior, telemetry isolation, persistence of provider and metric fields, and a concurrency-oriented quota race case.
- [x] The full validation matrix passes: Prisma validation and migration checks, seed, targeted Phase 5 tests, `npm run build`, the trusted-settlement smoke flow, and the full regression suite.

### Known Issues

- No product issues were found during Phase 5 verification.
- During ad hoc smoke scripting, `tsx` inline ESM evaluation exposed local TypeScript helpers as CommonJS-style modules. The smoke flow still completed successfully using `node -r tsx/cjs`; this was a scripting/runtime interop quirk, not an application defect.
