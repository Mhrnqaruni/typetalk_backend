## Phase 5 — Implementation Plan

### Objective

Phase 5 adds the trusted usage-control layer that the final plan requires before public launch: server-owned realtime session creation, trusted usage finalization, weekly quota enforcement, and usage visibility APIs. At the end of this phase, free-tier usage must be enforced safely in one database transaction, paid limits must come from the seeded `plans` table, and untrusted client telemetry must never become billable truth.

### Prerequisites

- Phase 0, Phase 1, Phase 2, Phase 3, and Phase 4 must already be completed and re-verified in the current workspace.
- The current backend must still pass `npm run build` and `npm run test` before any Phase 5 edits begin.
- `typetalk_dev` and `typetalk_test` must already be migrated through the Phase 4 billing schema and seeded so the canonical `plans.weekly_word_limit` values are available.
- The existing shared primitives from earlier phases must remain the extension points for this work: authenticated current-user and current-organization resolution, actor-scoped idempotency, shared pagination helpers, unified entitlement reads, and the existing Prisma transaction patterns used in billing.
- Phase 5 must not invent a live audio pipeline, live transcript storage, or raw client-declared billable truth. Trusted finalization in this phase must be based on server-owned `realtime_sessions` plus trusted session result fields stored by the backend, with tests simulating those trusted results directly.
- Phase 5 must continue the privacy rules from the final plan: do not store raw audio, raw transcript text, raw prompt text, or raw app context by default.

### Steps

1. Confirm the Phase 4 baseline and map the exact Phase 5 extension points.
   - What to do: rerun the current baseline and inspect `prisma/schema.prisma`, `prisma/seed.ts`, `src/app.ts`, `src/lib/idempotency.ts`, `src/lib/pagination.ts`, `src/modules/entitlements/service.ts`, `src/modules/billing/service.ts`, and the existing route and test harness patterns so the usage work extends the current control-plane architecture instead of creating a parallel subsystem.
   - Which files are affected: no code changes expected; review `prisma/schema.prisma`, `prisma/seed.ts`, `src/app.ts`, `src/lib/idempotency.ts`, `src/lib/pagination.ts`, `src/modules/entitlements/service.ts`, `src/modules/billing/service.ts`, `test/helpers/app.ts`, and `test/helpers/db.ts`.
   - Expected outcome / how to verify: `npm run build` and `npm run test` still pass before any Phase 5 edits, and there is a clear map of where auth context, plan limits, idempotency, pagination, and transaction-safe write paths already live.
   - Potential risks: skipping the baseline check can lead to a duplicate usage abstraction, quota logic that bypasses the seeded plan catalog, or route wiring that does not follow the existing auth and idempotency patterns.

2. Lock the trusted-usage data model and endpoint contract before editing the schema.
   - What to do: define the concrete Phase 5 usage rules in code-facing terms before writing the migration: `POST /v1/realtime/session` creates a server-owned session record, `POST /v1/usage/finalize` accepts a `realtime_session_id` plus request metadata but derives billable counts only from trusted fields already stored on that session, `POST /v1/usage/events` remains telemetry-only, and weekly summary data must come from trusted finalized usage rather than raw client telemetry.
   - Which files are affected: expected changes in `prisma/schema.prisma`, `src/modules/usage/schemas.ts`, `src/modules/usage/service.ts`, and `test/integration/usage.test.ts`.
   - Expected outcome / how to verify: there is one consistent model for session status, event status, trusted-result source, quota application, and telemetry-only behavior before any migration or route logic is implemented.
   - Potential risks: leaving the trust model ambiguous can cause later steps to accidentally spend quota from untrusted client payloads or mix telemetry data into billable counters.

3. Extend the Prisma schema for realtime sessions, quota windows, usage events, and weekly rollups.
   - What to do: add the Phase 5 tables to `prisma/schema.prisma`: `realtime_sessions`, `quota_windows`, `usage_events`, and `usage_rollups_weekly`. Introduce the explicit enums needed to model realtime session lifecycle and usage event status, add relations to `users`, `organizations`, and `devices`, add indexes for current-window lookup and rollup reads, and encode the uniqueness needed for one quota row per `(organization_id, user_id, feature_code, window_start)` and one rollup row per `(organization_id, user_id, week_start)`.
   - Which files are affected: `prisma/schema.prisma`.
   - Expected outcome / how to verify: `npx prisma validate` succeeds, the new schema can represent server-owned sessions, quota counters, trusted billable usage, telemetry-only usage records, and weekly aggregates without storing raw transcript content.
   - Potential risks: weak indexes will make quota reads and rollups slow, missing uniqueness on `quota_windows` will allow duplicate windows under concurrency, and vague event/session statuses will make finalize logic hard to enforce safely.

4. Create, inspect, and apply the Phase 5 migration to dev and test databases.
   - What to do: generate the Phase 5 migration, inspect the SQL before applying it, run it against `typetalk_dev`, and replay the same migration path against `typetalk_test`. Update any test DB reset ordering only if the new foreign keys require it.
   - Which files are affected: `prisma/migrations/<timestamp>_phase5_usage_and_quota/*`, `prisma/migration_lock.toml` if Prisma changes it, and `test/helpers/db.ts` only if reset ordering must be updated.
   - Expected outcome / how to verify: `npx prisma migrate dev --name phase5_usage_and_quota`, `npx prisma migrate status`, and test-DB `npx prisma migrate deploy` all succeed, and both databases now contain the Phase 5 tables and indexes.
   - Potential risks: an incorrect migration blocks the whole phase; the main failure modes are missing uniqueness on `quota_windows`, wrong foreign-key behavior on `devices` or `realtime_sessions`, or schema choices that make idempotent finalize replay hard later.

5. Scaffold the new `usage` module and register the Phase 5 routes in the app.
   - What to do: create `src/modules/usage/repository.ts`, `src/modules/usage/schemas.ts`, `src/modules/usage/service.ts`, and `src/modules/usage/routes.ts`, then register the module in `src/app.ts`. Reuse the same auth plugin, Zod parsing, and response conventions already used by the billing and preferences modules, and add a shared `Idempotency-Key` extraction helper only if the billing route helper cannot be reused cleanly.
   - Which files are affected: expected new files `src/modules/usage/repository.ts`, `src/modules/usage/schemas.ts`, `src/modules/usage/service.ts`, `src/modules/usage/routes.ts`; expected changes in `src/app.ts` and possibly a small shared helper file under `src/lib/`.
   - Expected outcome / how to verify: `POST /v1/realtime/session`, `POST /v1/usage/finalize`, `POST /v1/usage/events`, `GET /v1/usage/summary`, and `GET /v1/usage/quota` are registered with auth and validation hooks in place, and `npm run build` still passes before business logic is filled in.
   - Potential risks: duplicating route helpers from billing without extracting shared logic can create drift in idempotency-key handling and request validation behavior.

6. Add usage repository primitives and the UTC weekly-window helper.
   - What to do: implement repository methods for creating and loading realtime sessions, locking or upserting the current quota window, inserting usage events, updating weekly rollups, and reading current quota and summary data. Add a small helper that computes the active weekly window boundary as Monday 00:00 UTC and returns the corresponding window end.
   - Which files are affected: expected changes in `src/modules/usage/repository.ts`; expected new helper file such as `src/modules/usage/window.ts` or a focused utility under `src/lib/`.
   - Expected outcome / how to verify: the codebase has one reusable place for session persistence, quota-window lookup, rollup maintenance, and UTC week calculation, and later service logic can stay transaction-focused instead of re-implementing date math or raw Prisma filters.
   - Potential risks: incorrect UTC-week math will silently corrupt quota enforcement, and read-then-write repository patterns will make the later finalize path race-prone.

7. Implement `POST /v1/realtime/session` as the server-owned session creation path.
   - What to do: make the endpoint require auth, validate the requested device and feature metadata, enforce device ownership, create a server-owned realtime session row for the authenticated organization and user, and return the new session identifier plus safe session metadata. Do not spend quota here, and do not invent a live provider-streaming integration in this phase; the endpoint should create the durable backend session record that later trusted results will bind to.
   - Which files are affected: expected changes in `src/modules/usage/routes.ts`, `src/modules/usage/schemas.ts`, `src/modules/usage/service.ts`, `src/modules/usage/repository.ts`, and possibly `src/modules/devices/repository.ts` if a reusable ownership lookup is needed.
   - Expected outcome / how to verify: a valid authenticated request creates one realtime session row for an owned device, invalid or foreign device ids are rejected safely, and the route returns a stable response shape without mutating quota data.
   - Potential risks: skipping device ownership checks can let one user create sessions against another user’s device, and overreaching into a live audio-provider integration will add scope that the final plan explicitly defers.

8. Implement `POST /v1/usage/finalize` with actor-scoped idempotency and trusted-result enforcement.
   - What to do: require `Idempotency-Key`, validate the request payload, load the realtime session for the authenticated organization and user, reject missing, expired, or already-consumed sessions, and derive billable usage only from trusted fields already stored on that session such as `final_word_count` and `trusted_result_source`. The request may carry client metadata for correlation, but it must not be allowed to override the trusted billable count.
   - Which files are affected: expected changes in `src/modules/usage/routes.ts`, `src/modules/usage/schemas.ts`, `src/modules/usage/service.ts`, `src/modules/usage/repository.ts`, and possibly `src/lib/idempotency.ts` or a small shared helper if Phase 5 needs a reusable route-level idempotency-key reader.
   - Expected outcome / how to verify: finalize succeeds only when the session already contains a trusted result, the same idempotency key replays the stored result, a reused key with a different payload returns a conflict, and missing trusted session data returns an error without spending quota.
   - Potential risks: allowing client `word_count` to act as billable truth would violate the locked final plan, and skipping idempotency will let retries double-spend quota under normal mobile-network behavior.

9. Implement the atomic quota transaction and rollup updates inside finalize.
   - What to do: inside one serializable database transaction, resolve the current entitlement and plan, derive the correct weekly limit from `plans.weekly_word_limit`, compute the Monday-UTC quota window, find or create the quota row, reject the request if the increment would exceed the remaining limit, insert exactly one trusted finalized usage event, mark the session finalized, and upsert the weekly rollup. If the request exceeds quota, do not write the billable usage row or advance the quota counter.
   - Which files are affected: expected changes in `src/modules/usage/service.ts`, `src/modules/usage/repository.ts`, and possibly `src/modules/entitlements/service.ts` or `src/modules/billing/repository.ts` if a small read helper is needed to resolve the current plan and entitlement source cleanly.
   - Expected outcome / how to verify: one finalize request increments quota exactly once, paid organizations use the higher plan limit from the database, free organizations are rejected cleanly when the limit is exceeded, and idempotent replay does not create duplicate usage rows or double-advance the quota window.
   - Potential risks: any read-then-check-then-write sequence outside one transaction will leave quota enforcement vulnerable to races; reading limits from env variables instead of `plans` will drift from billing policy.

10. Implement `POST /v1/usage/events` as telemetry-only and keep it non-billable.
   - What to do: add the telemetry route so authenticated clients can submit bounded usage metadata or session-linked telemetry, store that metadata as a non-billable usage event, and explicitly prevent the route from touching `quota_windows`, trusted finalized session fields, or billable rollups. Keep the payload bounded to counts and metadata only; do not persist raw transcript text, raw audio, or app-context bodies.
   - Which files are affected: expected changes in `src/modules/usage/routes.ts`, `src/modules/usage/schemas.ts`, `src/modules/usage/service.ts`, `src/modules/usage/repository.ts`, and the Phase 5 integration tests.
   - Expected outcome / how to verify: the route stores telemetry records successfully, quota counters remain unchanged after telemetry submissions, and the endpoint cannot be used to bypass trusted finalize or free-tier enforcement.
   - Potential risks: if telemetry events update quota rows or trusted rollups, the backend will no longer distinguish analytics-only input from billable truth.

11. Implement `GET /v1/usage/quota` and `GET /v1/usage/summary` on top of the trusted data model.
   - What to do: build the read APIs so `GET /v1/usage/quota` returns the active weekly window, limit, used words, remaining words, and plan or entitlement context for the authenticated organization, while `GET /v1/usage/summary` returns trusted finalized usage totals for the current week from `usage_rollups_weekly`. Keep telemetry-only events out of quota math and out of the trusted summary unless a later product requirement explicitly asks for separate analytics output.
   - Which files are affected: expected changes in `src/modules/usage/routes.ts`, `src/modules/usage/schemas.ts`, `src/modules/usage/service.ts`, and `src/modules/usage/repository.ts`.
   - Expected outcome / how to verify: after one successful finalize, both read APIs reflect the new usage state; after telemetry-only submissions, quota output remains unchanged and summary remains based on trusted finalized usage only.
   - Potential risks: mixing telemetry into trusted usage summary will blur the line between analytics and enforcement, and incorrect empty-state handling will make new users appear over quota or missing access.

12. Extend the test harness and add focused Phase 5 integration coverage.
   - What to do: add a Phase 5 integration suite and any harness helpers needed to create owned devices, seed trusted realtime session results directly in the database, and reset the new tables safely between tests. Cover session creation, finalize success, finalize idempotency replay, finalize conflict on reused idempotency key with different payload, reject finalize when trusted session results are missing, free-quota exhaustion, paid-limit behavior sourced from the seeded plan catalog, Monday 00:00 UTC window behavior, telemetry-only events not affecting quota, and correct read output from `GET /v1/usage/quota` and `GET /v1/usage/summary`. Include at least one concurrency-oriented test so two finalize attempts against the same remaining quota cannot both spend successfully.
   - Which files are affected: expected new test file `test/integration/usage.test.ts`; expected changes in `test/helpers/app.ts`, `test/helpers/db.ts`, and any small usage-specific test helper files if they make trusted-result setup cleaner.
   - Expected outcome / how to verify: the targeted Phase 5 suite passes against `typetalk_test`, the trusted-result rule is explicitly exercised, and the concurrency case demonstrates that the quota transaction is race-safe instead of only correct under single-threaded tests.
   - Potential risks: only testing the happy path will leave quota races and idempotency bugs undiscovered, and failing to simulate trusted session results directly will make Phase 5 impossible to verify without prematurely building a live audio provider.

13. Run the full Phase 5 verification matrix and prepare the phase for execution review.
   - What to do: after implementation, run the full validation matrix: `npx prisma validate`, `npx prisma generate`, `npx prisma migrate status`, test-DB `npx prisma migrate deploy`, `npx prisma db seed`, targeted Phase 5 tests, `npm run build`, the full `npm run test` suite, and a representative smoke script that exercises realtime session creation, trusted finalize, quota read, summary read, and telemetry ingestion. Read the changed files after editing to confirm the code and report match what actually ran.
   - Which files are affected: no intended product-code changes beyond any last verification fixes; expected updates later in execution to `phase_5/exec_report.md` once the phase is implemented and verified.
   - Expected outcome / how to verify: Phase 5 has a repeatable verification path covering schema, migrations, seed data, targeted usage logic, and the full regression suite, and the eventual execution report can cite real command results instead of assumptions.
   - Potential risks: relying only on targeted usage tests can miss regressions in auth, billing, or entitlements that now participate in quota enforcement; skipping a smoke flow can leave request-shape or route-wiring bugs undiscovered.

### Testing Strategy

- Start with a baseline rerun before edits: `npm run build` and `npm run test`.
- After schema work, run `npx prisma validate`, `npx prisma generate`, `npx prisma migrate status`, test-DB `npx prisma migrate deploy`, and `npx prisma db seed` to confirm the Phase 5 schema and migration path are valid and applied.
- Add targeted Phase 5 integration coverage for:
  - `POST /v1/realtime/session` creating a server-owned session for an owned device
  - rejection of missing or foreign device ids during realtime session creation
  - trusted finalize success when `realtime_sessions.final_word_count` and `trusted_result_source` are already present
  - finalize rejection when trusted session results are missing
  - finalize idempotency replay with the same `Idempotency-Key`
  - finalize conflict when the same key is reused with a different request payload
  - free-tier quota consumption advancing exactly once
  - paid-tier finalize behavior using the higher `plans.weekly_word_limit` from seeded plan rows
  - Monday 00:00 UTC window behavior and rollover into a new quota window
  - quota exceeded rejecting the whole finalize request without writing a billable usage row
  - telemetry-only `POST /v1/usage/events` not mutating quota or trusted rollups
  - `GET /v1/usage/quota` returning correct limit, used, remaining, and window metadata
  - `GET /v1/usage/summary` returning trusted finalized usage totals only
  - at least one concurrency-oriented test showing that two competing finalize attempts cannot both spend the same remaining quota
- Because the audio pipeline is deliberately deferred, use test helpers or direct DB setup to seed trusted session results instead of building live provider streaming in Phase 5.
- Run representative smoke flows after the targeted suite: create realtime session, seed trusted result, finalize usage, read quota, read summary, submit telemetry event, and confirm quota remains unchanged.
- Finish with the full regression matrix: `npm run build`, the targeted usage suite, `npm run test`, and any direct smoke script used to validate the end-to-end Phase 5 flow.

### Success Criteria

- `realtime_sessions`, `quota_windows`, `usage_events`, and `usage_rollups_weekly` exist in Prisma and in both dev and test databases with the constraints needed for trusted usage enforcement.
- `POST /v1/realtime/session` exists, requires auth, validates device ownership, and creates a server-owned realtime session without spending quota.
- `POST /v1/usage/finalize` exists, requires `Idempotency-Key`, rejects untrusted client-declared billable truth, and only succeeds when a trusted session result is already stored on the backend-owned session.
- Finalize applies quota enforcement in one database transaction, derives limits from the seeded `plans.weekly_word_limit` field, and uses Monday 00:00 UTC weekly windows.
- Repeating finalize with the same idempotency key does not double-spend quota or create duplicate billable usage rows.
- `POST /v1/usage/events` remains telemetry-only and cannot mutate quota windows, trusted finalized session state, or billable rollups.
- `GET /v1/usage/quota` and `GET /v1/usage/summary` return correct usage visibility for free and paid organizations without exposing raw transcript text, raw audio, or app context.
- The targeted Phase 5 integration suite covers trusted finalize, quota exceeded behavior, UTC weekly-window behavior, telemetry isolation, and a concurrency-oriented quota race case.
- The full validation matrix passes: Prisma validation and migration checks, seed, targeted Phase 5 tests, `npm run build`, representative smoke flows, and the full regression suite.
