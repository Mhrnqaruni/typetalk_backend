## Phase 4 — Execution Report

### Fixes Applied — Review Round 7

1. Malformed Google RTDN payloads were returning `500 internal_error` instead of a safe `400 invalid_google_rtdn_payload`.
- Did I confirm it: Yes. Before the fix, I replayed `POST /v1/webhooks/google-play/rtdn` through the app harness with a valid bearer token and malformed body `{not-json`, and the route returned `500 internal_error`.
- What I fixed: I extracted shared RTDN payload parsing into `src/modules/billing/google-play.ts` and normalized outer JSON parse failures, missing `message.data`, invalid base64, UTF-8 decode failures, and decoded inner JSON failures into `AppError(400, "invalid_google_rtdn_payload", ...)`. Both the live provider and the stub provider now call the same parser.
- How I verified: `npx vitest run test/integration/billing.google-rtdn.test.ts`, `npx vitest run test/integration/billing.google-play.test.ts test/integration/billing.google-rtdn.test.ts`, `npm run build`, `npm run test`, `npm run billing:webhooks:retry`, and a direct in-process replay all passed. The direct replay now returns `400 invalid_google_rtdn_payload` for malformed JSON and writes no durable Google webhook rows.

2. The RTDN integration harness did not enforce the real Pub/Sub `message.data` contract used by production.
- Did I confirm it: Yes. Before the fix, the stub only keyed off `message.messageId`, so a payload with no `message.data` could still be accepted if that message id had been preloaded in the stub.
- What I fixed: I removed the fake RTDN event lookup from `test/helpers/app.ts`, made the stub parse the same base64-encoded `message.data` payload as production, updated `test/integration/billing.google-rtdn.test.ts` to send real RTDN-shaped envelopes, and added explicit regression coverage for malformed outer JSON, missing `message.data`, invalid base64, invalid decoded JSON, and missing purchase token.
- How I verified: the RTDN suite now exercises real Pub/Sub-shaped payloads, the combined Google billing plus RTDN suites pass with the updated contract, the full regression suite still passes, and a direct replay of an RTDN envelope with `messageId` but no `message.data` now returns `400 invalid_google_rtdn_payload` instead of being accepted by the stub.

### Summary

Phase 4 added Google Play billing to the existing Stripe-first backend without creating a separate billing stack. The implementation introduced durable `purchase_tokens`, secure Google subscription verification and restore flows, RTDN trust verification and durable receipt, acknowledgment retry recovery, and unified Google-aware billing and entitlement reads. The main work landed in the billing module, the Phase 4 Prisma migration and seed catalog, the Google provider implementation, the retry job, and the new Google billing integration suites.

### Step-by-Step Execution Log

#### Step 1: Confirm the Phase 3 billing baseline and map the exact Google Play extension points
- Action taken: Re-read `final_plan.md`, `project_status.md`, `phase_3/exec_report.md`, and the approved Phase 4 plan, then inspected the live Phase 3 billing and entitlement extension points in `prisma/schema.prisma`, `prisma/seed.ts`, `src/config/env.ts`, `src/app.ts`, `src/modules/billing/*`, `src/modules/entitlements/service.ts`, `src/jobs/webhook-retry.ts`, and `test/helpers/app.ts`.
- Files modified: None.
- Verification: `npm run build` and the pre-change `npm run test` baseline both passed, confirming the Phase 3 billing foundation was stable before Phase 4 edits began.
- Status: DONE

#### Step 2: Extend configuration parsing, provider injection, and test harness support for Google Play and RTDN
- Action taken: Added Google Play runtime config parsing and validation, wired Google provider injection through the app bootstrap, added test/local env values, and extended the shared test harness with a deterministic Google Play stub.
- Files modified: `package.json` - added `google-auth-library`; `.env.local` - added local Play and RTDN variables; `.env.test` - added test Play and RTDN variables; `src/config/env.ts` - parsed Play package, service account, audience, and trusted service-account fields; `src/app.ts` - accepted `googlePlayProvider` injection; `test/helpers/app.ts` - added the stub Google Play provider and harness wiring; `test/lib/email-provider.test.ts` - updated config shape for the expanded app config.
- Verification: `npm run build` passed after the new config surface and provider injection path were added.
- Status: DONE

#### Step 3: Extend the Prisma schema for durable Google Play purchase-token storage and route-originated acknowledgment retry state
- Action taken: Added the Phase 4 `PurchaseAcknowledgmentStatus` enum and the `PurchaseToken` model with durable token identity, linked-token support, provider status, acknowledgment tracking, and scheduled acknowledgment retry metadata.
- Files modified: `prisma/schema.prisma` - added the new enum, model, indexes, and relations to `organizations`, `plans`, and `subscriptions`.
- Verification: `npx prisma format` and `npx prisma validate` both succeeded on the updated schema.
- Status: DONE

#### Step 4: Create, inspect, and apply the Phase 4 migration to dev and test databases
- Action taken: Generated the Phase 4 migration, inspected the SQL, applied it to `typetalk_dev`, and replayed the same migration path against `typetalk_test`.
- Files modified: `prisma/migrations/20260326051546_phase4_google_play_billing/migration.sql` - created the Phase 4 Google billing table and indexes; `prisma/migrations/migration_lock.toml` - retained the migration lock metadata.
- Verification: `npx prisma migrate dev --name phase4_google_play_billing`, `npx prisma migrate status`, and test-DB `npx prisma migrate deploy` all completed successfully.
- Status: DONE

#### Step 5: Extend the seeded plan catalog so Google Play plan mapping lives in the database
- Action taken: Updated the canonical plan seed so `pro_monthly` and `pro_yearly` now carry non-null Google product and base-plan identifiers while `free` remains unmapped.
- Files modified: `prisma/seed.ts` - added the Google plan identifiers to the seeded catalog.
- Verification: `npx prisma db seed` succeeded, and the targeted Google billing suite later asserted that the seeded `pro_monthly` and `pro_yearly` rows expose the expected Google identifiers.
- Status: DONE

#### Step 6: Add the Google Play provider abstraction and deterministic test doubles
- Action taken: Extended the provider contract for Google Play verification, acknowledgment, and RTDN verification, implemented the live Android Publisher and Pub/Sub trust path, and expanded the test harness with a controllable Google provider stub.
- Files modified: `src/modules/billing/provider.ts` - added Google provider interfaces; `src/modules/billing/google-play.ts` - implemented the live Google Play provider; `test/helpers/app.ts` - added the deterministic Google Play stub; `src/jobs/webhook-retry.ts` - later extended to accept injected providers during tests.
- Verification: `npm run build` passed and the Google-specific integration suites ran entirely against the stub provider without live Google calls.
- Status: DONE

#### Step 7: Add repository primitives for `purchase_tokens`, Google plan resolution, provider mappings, and shared sync state
- Action taken: Extended the billing repository with Google plan lookup by `(googleProductId, googleBasePlanId)`, purchase-token upsert and lookup helpers, acknowledgment retry queries, and Google invoice-list support.
- Files modified: `src/modules/billing/repository.ts` - added Google plan resolution, `purchase_tokens` persistence, retry claim/list helpers, and purchase-token invoice reads.
- Verification: `npm run build` passed, and the Google billing tests exercised DB-backed plan resolution, durable purchase-token reuse, and acknowledgment retry persistence successfully.
- Status: DONE

#### Step 8: Add request and response schemas and route skeletons for the new Phase 4 endpoints
- Action taken: Added request validation for Google verify and restore, registered the authenticated Google billing routes, and added the public RTDN webhook route under the shared webhook module with raw-body handling.
- Files modified: `src/modules/billing/schemas.ts` - added Google subscription action schemas; `src/modules/billing/routes.ts` - added `POST /v1/billing/google-play/verify-subscription`, `POST /v1/billing/google-play/restore`, and `POST /v1/webhooks/google-play/rtdn`; `src/app.ts` - kept the billing and webhook modules registered through the shared app bootstrap.
- Verification: `npm run build` passed, and the Google billing suite verified route-level validation including required `Idempotency-Key` handling.
- Status: DONE

#### Step 9: Implement `POST /v1/billing/google-play/verify-subscription` with actor-scoped idempotency, secure provider verification, and DB-backed plan resolution
- Action taken: Implemented the Google verify flow through a shared Google billing support layer that uses actor-scoped idempotency, secure provider verification, seeded plan lookup, organization binding, durable purchase-token writes, and a stable replayable response.
- Files modified: `src/modules/billing/google-play-support.ts` - added the shared verify path; `src/modules/billing/service.ts` - exposed the public verify method; `src/modules/billing/routes.ts` - routed verified requests into the service.
- Verification: `npx vitest run test/integration/billing.google-play.test.ts` passed for happy-path verify, idempotent replay, same-key conflict, and seeded plan resolution through the database catalog.
- Status: DONE

#### Step 10: Implement initial purchase acknowledgment and durable route-originated acknowledgment retry state
- Action taken: Added post-verification Google acknowledgment, persisted durable acknowledgment success or failure on `purchase_tokens`, and scheduled acknowledgment retry state on the token row when the initial ack failed.
- Files modified: `src/modules/billing/google-play-support.ts` - added immediate acknowledgment plus failure scheduling; `src/modules/billing/repository.ts` - added acknowledgment success and retry persistence helpers.
- Verification: the Google billing suite passed the forced ack-failure case, showing that access remained correct while the durable token row moved into retryable acknowledgment state.
- Status: DONE

#### Step 11: Implement `POST /v1/billing/google-play/restore` using the same durable sync and acknowledgment path as verify
- Action taken: Implemented the restore route on top of the same Google sync pipeline so restore reuses existing durable state, idempotency handling, and acknowledgment tracking instead of introducing a separate write path.
- Files modified: `src/modules/billing/google-play-support.ts` - added the restore flow on the shared sync path; `src/modules/billing/service.ts` - exposed restore; `src/modules/billing/routes.ts` - registered the restore endpoint.
- Verification: the Google billing suite passed for restore success, replay-safe idempotency, and duplicate-state avoidance.
- Status: DONE

#### Step 12: Extend provider-state sync so Google Play updates the shared subscription model correctly
- Action taken: Mapped Google provider state into the shared `subscriptions`, `provider_customers`, and `purchase_tokens` tables, kept pending purchases non-entitling, and handled linked purchase tokens without losing the durable token chain.
- Files modified: `src/modules/billing/google-play-support.ts` - added shared Google sync logic; `src/modules/entitlements/service.ts` - treated `INCOMPLETE` as non-entitling free access for unified reads.
- Verification: the Google billing suite passed for pending-state denial, linked purchase-token replacement, and overlap-safe entitlement behavior.
- Status: DONE

#### Step 13: Extend entitlement recomputation and the unified billing read APIs for Google-backed state
- Action taken: Extended the shared billing reads so Google-backed subscriptions, entitlements, and invoice reads remain unified, and corrected invoice provider selection to follow the active entitlement source instead of any stale Stripe customer mapping.
- Files modified: `src/modules/billing/service.ts` - added Google-aware invoice fallback based on the current entitlement source provider; `src/modules/entitlements/service.ts` - continued to drive the unified subscription summary and entitlement reads.
- Verification: the Google billing suite passed for unified `GET /v1/billing/subscription`, `GET /v1/entitlements/current`, and `GET /v1/billing/invoices`, including the regression where a stale Stripe customer mapping must not hide active Google invoices.
- Status: DONE

#### Step 14: Implement `POST /v1/webhooks/google-play/rtdn` trust verification, envelope handling, and transport-id extraction
- Action taken: Implemented RTDN trust verification through the Google provider, validated the webhook envelope, extracted the stable Pub/Sub `messageId`, and rejected untrusted deliveries before any durable billing state was written.
- Files modified: `src/modules/billing/google-play.ts` - implemented RTDN token verification and envelope parsing; `src/modules/billing/routes.ts` - added the public RTDN route.
- Verification: the Google RTDN suite passed for trusted deliveries and for rejection of invalid bearer tokens with no durable Google webhook row created.
- Status: DONE

#### Step 15: Implement durable RTDN receipt, dedupe, insert-first processing, and Google event handling
- Action taken: Extended the durable webhook pipeline so RTDN deliveries insert or reuse a `webhook_events` row keyed by the Pub/Sub `messageId`, persist only a minimal retry-safe snapshot, and process Google state through the same durable state machine used by Stripe.
- Files modified: `src/modules/billing/google-play-support.ts` - added RTDN receive and process helpers; `src/modules/billing/service.ts` - added Google webhook receipt and payload deserialization; `src/modules/billing/repository.ts` - reused the shared webhook-event storage; `src/modules/billing/routes.ts` - sent RTDN requests through the durable path.
- Verification: the Google RTDN suite passed for minimal payload storage, duplicate redelivery dedupe by `messageId`, and separate Pub/Sub messages for the same purchase token remaining independently processable.
- Status: DONE

#### Step 16: Extend the reconciliation executor and job entrypoint so both Google RTDN failures and route-originated acknowledgment failures are recoverable
- Action taken: Extended the shared retry job to process Google RTDN-backed `webhook_events` plus pending `purchase_tokens` acknowledgment retries, and exposed provider injection so the same job path can be exercised deterministically in tests.
- Files modified: `src/jobs/webhook-retry.ts` - added provider injection support while keeping the live CLI path; `src/modules/billing/service.ts` - combined Google webhook retries with acknowledgment retries; `src/modules/billing/google-play-support.ts` - added due-ack retry execution.
- Verification: the Google billing suite passed for "verify succeeds, ack fails, no RTDN arrives, retry job later acknowledges" and the Google RTDN suite passed for failed-row recovery and stale-processing reclamation. `npm run billing:webhooks:retry` also executed successfully against the clean database.
- Status: DONE

#### Step 17: Add full integration coverage and run the complete Phase 4 verification matrix
- Action taken: Added the dedicated Google billing and RTDN suites, reran targeted Google verification, reran the full Prisma and test matrix, and executed a representative endpoint smoke script covering verify-subscription, restore, entitlement read, billing summary read, invoice read, RTDN delivery, and the retry job.
- Files modified: `test/integration/billing.google-play.test.ts` - added Phase 4 Google verify, restore, linked-token, ack-retry, overlap, and invoice coverage; `test/integration/billing.google-rtdn.test.ts` - added RTDN trust, dedupe, failure, and stale-lock recovery coverage; `test/helpers/app.ts` - extended stub behavior needed by the new suites.
- Verification: `npx prisma validate`, `npx prisma generate`, `npx prisma migrate status`, test-DB `npx prisma migrate deploy`, `npx prisma db seed`, `npx vitest run test/integration/billing.google-play.test.ts test/integration/billing.google-rtdn.test.ts`, `npm run build`, `npm run test`, `npm run billing:webhooks:retry`, and the representative smoke script all succeeded. The first smoke-script attempt failed because `tsx -` treated the test helper import as ESM/CJS-incompatible; I reran it with CommonJS-style loads and the smoke pass then completed successfully.
- Status: DONE_WITH_DEVIATION

### Testing Results

```text
$ npx prisma validate
Prisma schema loaded from prisma\schema.prisma
The schema at prisma\schema.prisma is valid 🚀
Environment variables loaded from .env
```

```text
$ npx prisma generate
Prisma schema loaded from prisma\schema.prisma
Generated Prisma Client (v6.19.2) to .\node_modules\@prisma\client
Environment variables loaded from .env
```

```text
$ npx prisma migrate status
Datasource "db": PostgreSQL database "typetalk_dev", schema "public" at "127.0.0.1:55432"
5 migrations found in prisma/migrations
Database schema is up to date!
```

```text
$ DATABASE_URL=postgresql://postgres@127.0.0.1:55432/typetalk_test?schema=public npx prisma migrate deploy
Datasource "db": PostgreSQL database "typetalk_test", schema "public" at "127.0.0.1:55432"
5 migrations found in prisma/migrations
No pending migrations to apply.
```

```text
$ npx prisma db seed
Running seed command `tsx prisma/seed.ts` ...
The seed command has been executed.
```

```text
$ npx vitest run test/integration/billing.google-play.test.ts test/integration/billing.google-rtdn.test.ts
Test Files  2 passed (2)
Tests       9 passed (9)
Duration    12.96s
```

```text
$ npm run build
> typetalk-backend@0.1.0 build
> tsc -p tsconfig.json
```

```text
$ npm run test
Test Files  14 passed (14)
Tests       57 passed (57)
Duration    71.95s
```

```text
$ npm run billing:webhooks:retry
{
  "scanned": 0,
  "processed": 0,
  "failed": 0,
  "skipped": 0
}
```

```text
$ phase-4 representative smoke script
{
  "verify_subscription": 200,
  "restore": 200,
  "entitlement_current": 200,
  "billing_subscription": 200,
  "billing_invoices": 200,
  "google_rtdn": 200,
  "retry_job": {
    "scanned": 0,
    "processed": 0,
    "failed": 0,
    "skipped": 0
  }
}
```

### Success Criteria Checklist

- [x] `purchase_tokens` exists in Prisma and in both dev and test databases with the constraints needed for durable `purchaseToken` storage, linked-token traversal, acknowledgment tracking, and route-originated acknowledgment retry state.
- [x] `prisma/seed.ts` maps `pro_monthly` and `pro_yearly` to non-null Google product and base-plan identifiers, and Google billing flows resolve plans through the `plans` table rather than hardcoded service constants.
- [x] `POST /v1/billing/google-play/verify-subscription` exists, validates input, requires `Idempotency-Key`, verifies provider state securely, persists durable token state, and does not grant access while the provider state is pending or otherwise non-entitling.
- [x] `POST /v1/billing/google-play/restore` exists, validates input, reuses the same durable sync path as verify, and is idempotent for repeated requests.
- [x] Initial Google purchases are acknowledged only after successful secure verification, and a first-attempt acknowledgment failure leaves durable retryable state that can later be reconciled even if no RTDN arrives.
- [x] `POST /v1/webhooks/google-play/rtdn` exists, verifies trust and auth data before processing, stores a minimal retry-safe payload durably, binds `webhook_events.external_event_id` to the Pub/Sub transport message id, acknowledges receipt quickly, and keeps failed downstream work retryable.
- [x] The shared `webhook_events` pipeline and `src/jobs/webhook-retry.ts` process Google RTDN rows in `received`, `failed`, and stale `processing` states successfully, and the same scheduled recovery path also reconciles pending Google acknowledgment retries stored on `purchase_tokens`.
- [x] Google verify, restore, and RTDN-driven sync all update the shared billing tables so `GET /v1/billing/subscription`, `GET /v1/billing/invoices`, and `GET /v1/entitlements/current` remain unified when Google Play is the active provider.
- [x] Stripe and Google Play overlap for the same organization preserves paid access and surfaces `billing_overlap=true`.
- [x] The full Phase 4 build, migration, seed, targeted integration tests, reconciliation-job verification, and complete regression suite all pass.

### Known Issues

- No open functional Phase 4 billing issues were identified after the Review Round 7 verification rerun.
- Local verification ran on Node `v24.13.0`; the locked target runtime in the final plan remains Node 22.
- Prisma emitted the existing deprecation warning that `package.json#prisma` should eventually move to `prisma.config.ts`; the current seed path still works and did not block Phase 4 verification.
