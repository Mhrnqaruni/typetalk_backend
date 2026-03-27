## Phase 4 — Implementation Plan

### Objective

Phase 4 extends the existing Stripe-first billing system to support Android subscriptions through secure Google Play verification, durable purchase-token storage, RTDN ingestion, and unified entitlement recomputation. At the end of this phase, Google Play and Stripe must both drive the same organization-scoped billing and entitlement APIs without granting access from untrusted or pending provider state.

### Prerequisites

- Phase 0, Phase 1, Phase 2, and Phase 3 must already be completed and re-verified in the current workspace.
- The current backend must still pass `npm run build` and `npm run test` before any Phase 4 edits begin.
- `typetalk_dev` and `typetalk_test` must already be migrated through the Phase 3 Stripe billing schema and seeded with the canonical plans.
- The existing shared primitives from earlier phases must remain the extension points for this work: current-organization resolution, actor-scoped idempotency, shared cursor pagination, unified entitlement recomputation, and the Phase 3 durable `webhook_events` retry pipeline.
- Google Play configuration required by the locked final plan must be available in local and test env files before live-provider integration is attempted: package name, service-account credentials or key path, any issuer/client metadata needed for Android Publisher API access, RTDN trust-verification settings, and bounded retry/lock settings for the extended webhook retry executor.
- Phase 4 must not implement Phase 5 usage metering or quota enforcement logic; this phase is limited to Google Play billing, provider sync, RTDN durability, and unified billing/entitlement reads.

### Steps

1. Confirm the Phase 3 billing baseline and map the exact Google Play extension points.
   - What to do: rerun the current baseline and inspect `prisma/schema.prisma`, `src/config/env.ts`, `src/app.ts`, `src/modules/billing/provider.ts`, `src/modules/billing/repository.ts`, `src/modules/billing/service.ts`, `src/modules/billing/routes.ts`, `src/modules/entitlements/service.ts`, `src/jobs/webhook-retry.ts`, and `test/helpers/app.ts` so the Google Play work extends the existing Stripe and entitlement paths instead of creating a parallel billing stack.
   - Which files are affected: no code changes expected; review `prisma/schema.prisma`, `src/config/env.ts`, `src/app.ts`, `src/modules/billing/provider.ts`, `src/modules/billing/repository.ts`, `src/modules/billing/service.ts`, `src/modules/billing/routes.ts`, `src/modules/entitlements/service.ts`, `src/jobs/webhook-retry.ts`, and `test/helpers/app.ts`.
   - Expected outcome / how to verify: `npm run build` and `npm run test` still pass before any Phase 4 changes, and there is a clear map of where plan resolution, provider injection, webhook persistence, retry logic, and entitlement recomputation already live.
   - Potential risks: skipping the baseline check can produce duplicate billing abstractions, break the existing Stripe paths, or cause Google logic to bypass the shared idempotency and retry infrastructure that earlier phases already proved out.

2. Extend configuration parsing, provider injection, and test harness support for Google Play and RTDN.
   - What to do: add the Google Play and RTDN configuration surface needed by the locked plan, extend env parsing and validation, and update the app/test harness so billing services can accept an injected Google Play provider stub alongside the existing Stripe provider. Include bounded stale-lock and retry settings if the Phase 3 job needs additional Google-specific tuning.
   - Which files are affected: expected changes in `package.json`, `.env.example`, `.env.test`, `src/config/env.ts`, `src/app.ts`, `test/helpers/app.ts`, and `src/modules/billing/provider.ts`; expected new provider-facing files such as `src/modules/billing/google-play.ts`.
   - Expected outcome / how to verify: the app starts with validated Google Play config, tests can run with a stub Google provider instead of live network calls, and `npm run build` still passes after the provider abstraction is extended.
   - Potential risks: making live Google credentials mandatory in tests will break repeatable local verification; putting Google-specific env reads directly inside route handlers will make the app harder to validate and test safely.

3. Extend the Prisma schema for durable Google Play purchase-token storage.
   - What to do: add the Phase 4 `purchase_tokens` model to `prisma/schema.prisma` and wire it to the existing Phase 3 billing models. Use `purchaseToken` as the durable Google key, include support for `linkedPurchaseToken`, capture the plan and organization mapping required for reconciliation, store secure acknowledgment state such as `acknowledged_at`, and add indexes and uniqueness rules that prevent duplicate durable token rows while still allowing token-chain traversal for subscription upgrades and replacements.
   - Which files are affected: `prisma/schema.prisma`.
   - Expected outcome / how to verify: the schema contains the locked Phase 4 table with relations and constraints that support secure token storage, linked-token resolution, idempotent verify/restore flows, acknowledgment tracking, and later RTDN reconciliation.
   - Potential risks: weak uniqueness rules can let the same purchase token create duplicate durable rows; missing linked-token indexes can make upgrade-chain reconciliation unreliable; storing the wrong durable key will break Google re-verification and RTDN processing.

4. Create, inspect, and apply the Phase 4 migration to dev and test databases.
   - What to do: generate the Phase 4 migration, inspect the SQL before applying it, run it against `typetalk_dev`, and verify the same migration path against `typetalk_test`.
   - Which files are affected: `prisma/migrations/<timestamp>_phase4_google_play_billing/*` and `prisma/migration_lock.toml` only if Prisma updates it.
   - Expected outcome / how to verify: `npx prisma migrate dev` succeeds, the generated SQL matches the intended `purchase_tokens` table and indexes, `npx prisma migrate status` shows dev up to date, and test-DB `npx prisma migrate deploy` succeeds with no pending migrations.
   - Potential risks: an incorrect migration blocks the whole phase; the main failure modes are wrong nullability on token-chain fields, missing uniqueness on the durable token key, or foreign keys that do not match the current billing schema.

5. Add the Google Play provider abstraction and deterministic test doubles.
   - What to do: extend the provider layer so the billing module can securely call Google Play verification, subscription-state lookup, and acknowledgment APIs through an injectable abstraction. Keep the live implementation isolated in a Google-specific provider file and add deterministic stubs for tests, including controllable responses for active, trial, grace, canceled, expired, pending, linked-token, and acknowledgment-failure scenarios.
   - Which files are affected: expected changes in `src/modules/billing/provider.ts` and `test/helpers/app.ts`; expected new files such as `src/modules/billing/google-play.ts` and a helper fixture file under `test/helpers/`.
   - Expected outcome / how to verify: the project compiles with a provider interface that supports both Stripe and Google Play operations, and integration tests can script provider-state transitions without making live Google API calls.
   - Potential risks: mixing live SDK calls directly into `BillingService` will make tests brittle and slow; an abstraction that omits acknowledgment or linked-token lookups will force unsafe service-layer workarounds later in the phase.

6. Add repository primitives for `purchase_tokens`, Google provider mappings, and shared sync state.
   - What to do: extend the billing repository so it can create, update, and query `purchase_tokens`, resolve tokens by durable key or linked key, find or create the Google `provider_customers` mapping for an organization, and reuse the existing `subscriptions`, `entitlements`, and `webhook_events` tables instead of inventing Google-only copies. The repository must support transaction-friendly upserts because verify, restore, RTDN processing, and retry execution will all use the same durable sync path.
   - Which files are affected: expected changes in `src/modules/billing/repository.ts`, `src/modules/entitlements/repository.ts`, and any shared repository helper files already used by Phase 3 billing.
   - Expected outcome / how to verify: repository methods exist for token upsert, linked-token traversal, provider-customer lookup, subscription upsert, and webhook-event persistence, and the code still builds after the new persistence primitives are added.
   - Potential risks: splitting Google state across too many write paths can create race conditions between verify, restore, and RTDN; repository methods that are not transaction-safe will make idempotency and retry behavior unreliable.

7. Add request/response schemas and route skeletons for the new Phase 4 endpoints.
   - What to do: define the validation and response contracts for `POST /v1/billing/google-play/verify-subscription`, `POST /v1/billing/google-play/restore`, and `POST /v1/webhooks/google-play/rtdn`, then register route skeletons that reuse the existing auth, current-organization, and error-handling paths from earlier phases.
   - Which files are affected: expected changes in `src/modules/billing/schemas.ts`, `src/modules/billing/routes.ts`, and `src/app.ts`.
   - Expected outcome / how to verify: the three locked Phase 4 routes exist in the app with validated request shapes and placeholder handlers, the webhook path is publicly reachable without session auth, and `npm run build` still passes before business logic is filled in.
   - Potential risks: weak schema validation can allow malformed purchase data or malformed RTDN envelopes into durable processing; bypassing shared auth/current-organization helpers will make route ownership and idempotency scoping inconsistent.

8. Implement `POST /v1/billing/google-play/verify-subscription` with actor-scoped idempotency and secure provider verification.
   - What to do: implement the authenticated verify route so it requires `Idempotency-Key`, verifies the Google purchase/subscription state through the provider abstraction, maps the token to the current organization, persists `purchaseToken` as the durable key, follows `linkedPurchaseToken` when present, rejects untrusted or mismatched mapping data, and returns a stable replayable response through the Phase 2 idempotency infrastructure. Do not grant paid access from pending or otherwise non-entitled provider state.
   - Which files are affected: expected changes in `src/modules/billing/routes.ts`, `src/modules/billing/schemas.ts`, `src/modules/billing/service.ts`, `src/modules/billing/repository.ts`, `src/modules/billing/google-play.ts`, and new or updated integration coverage in `test/integration/billing.google-play.test.ts`.
   - Expected outcome / how to verify: the first valid verify request creates one durable token/subscription sync result, the same key plus same payload replays the stored response, the same key plus different payload returns conflict, a pending purchase does not grant paid entitlement, and linked-token verification reuses the correct durable chain instead of creating disconnected rows.
   - Potential risks: failing to bind the token to the authenticated organization can leak subscriptions across accounts; granting access before secure provider verification violates the locked trust model; broken idempotency can create duplicate durable sync rows.

9. Implement initial purchase acknowledgment and acknowledgment-retry state handling.
   - What to do: after a successful secure verification of an initial Google purchase, attempt provider acknowledgment, persist the acknowledgment result on the durable token record, and keep the system retry-safe when the first acknowledgment attempt fails. The durable record must make it possible to retry acknowledgment later without re-granting entitlements or losing track of the original token.
   - Which files are affected: expected changes in `src/modules/billing/service.ts`, `src/modules/billing/repository.ts`, `src/modules/billing/google-play.ts`, and the `purchase_tokens` persistence path introduced earlier; expected test updates in `test/integration/billing.google-play.test.ts`.
   - Expected outcome / how to verify: a securely verified unacknowledged purchase is acknowledged once, the durable token row records `acknowledged_at` or equivalent retryable failure state, and a forced acknowledgment failure leaves the purchase sync correct while preserving a clean retry path.
   - Potential risks: acknowledging before verification is unsafe; tying acknowledgment success to entitlement grant can incorrectly deny valid access when the entitlement sync succeeded but acknowledgment needs retry; non-durable ack state will make recovery from partial failure impossible.

10. Implement `POST /v1/billing/google-play/restore` using the same durable sync path as verify.
   - What to do: implement the authenticated restore route so it accepts the trusted token/account mapping data needed by Android restore flows, reuses the same provider verification and persistence pipeline as verify, requires actor-scoped idempotency, and safely reattaches existing Google purchase state to the current organization without duplicating tokens, provider-customer rows, or subscription rows.
   - Which files are affected: expected changes in `src/modules/billing/routes.ts`, `src/modules/billing/schemas.ts`, `src/modules/billing/service.ts`, `src/modules/billing/repository.ts`, and `test/integration/billing.google-play.test.ts`.
   - Expected outcome / how to verify: restore succeeds for an existing valid Google subscription, repeated restore calls with the same key replay safely, conflicting payloads return conflict, and restoring an already-known token reuses the existing durable state rather than creating duplicates.
   - Potential risks: implementing restore as a separate write path from verify can create drift between the two flows; failing to reuse the durable token chain can break upgrades and account recovery.

11. Extend provider-state sync so Google Play updates the shared subscription model correctly.
   - What to do: map secure Google provider state into the existing `subscriptions`, `provider_customers`, and `purchase_tokens` data model so the backend reflects trial, active, grace, payment issue, canceled, expired, or pending-like Google states correctly. Keep `subscriptions` organization-scoped, reflect cancellation as provider state rather than app-side deletion, and ensure linked-token replacement updates the durable token chain without losing historical reconciliation data.
   - Which files are affected: expected changes in `src/modules/billing/service.ts`, `src/modules/billing/repository.ts`, `src/modules/billing/google-play.ts`, and `src/modules/entitlements/service.ts`.
   - Expected outcome / how to verify: a secure verify, restore, or RTDN-driven sync updates the shared Phase 3 subscription model correctly, pending state remains non-entitling, cancellation and expiry transitions are reflected durably, and linked-token upgrades produce one coherent current subscription state for the organization.
   - Potential risks: forcing Google state into Stripe-specific assumptions can corrupt billing reads; incorrect status mapping can either overgrant paid access or prematurely drop access; losing the linked-token chain can break replacements and restorations.

12. Extend entitlement recomputation and the unified billing read APIs for Google-backed state.
   - What to do: update the entitlement engine and billing read models so `GET /v1/entitlements/current`, `GET /v1/billing/subscription`, and `GET /v1/billing/invoices` remain unified when Google Play is the active provider. Preserve the locked organization-first entitlement rules, set `billing_overlap=true` when paid Google Play and paid Stripe access overlap for the same organization, and keep invoices paginated through the shared `items` plus `next_cursor` contract even when the active provider is Google Play.
   - Which files are affected: expected changes in `src/modules/entitlements/service.ts`, `src/modules/entitlements/repository.ts`, `src/modules/entitlements/routes.ts`, `src/modules/billing/service.ts`, `src/modules/billing/repository.ts`, `src/modules/billing/routes.ts`, `src/modules/billing/schemas.ts`, and billing integration tests.
   - Expected outcome / how to verify: the same read routes used in Phase 3 now return correct Google-backed billing summaries and entitlements, `billing_overlap=true` appears when Stripe and Google paid states coexist, and list responses still follow the shared pagination contract.
   - Potential risks: resolving Google billing by user instead of organization will break the locked entitlement rules; leaving Google out of the read models will force Android-specific APIs and violate the unified-billing requirement.

13. Implement `POST /v1/webhooks/google-play/rtdn` trust verification and envelope handling.
   - What to do: add the RTDN webhook route so it verifies the Google/Pub/Sub trust data required by the final plan before any business processing occurs, validates the notification envelope, extracts a minimal retry-safe payload, and rejects malformed or untrusted deliveries without writing durable billing state.
   - Which files are affected: expected changes in `src/config/env.ts`, `src/app.ts`, `src/modules/billing/routes.ts`, `src/modules/billing/schemas.ts`, `src/modules/billing/google-play.ts`, and webhook integration tests such as `test/integration/billing.google-rtdn.test.ts`.
   - Expected outcome / how to verify: valid trusted RTDN deliveries are accepted, invalid trust headers/tokens or malformed envelopes are rejected safely, and the persisted payload shape is limited to the fields needed for durable retry-safe processing rather than the entire raw push body.
   - Potential risks: skipping trust verification would let untrusted callers mutate billing state; storing the raw Pub/Sub payload forever can violate the project's privacy posture and make retries harder to reason about.

14. Implement durable RTDN receipt, dedupe, insert-first processing, and Google event handling.
   - What to do: extend the Phase 3 webhook-event pipeline so Google RTDN deliveries first insert or upsert a `webhook_events` row, use the shared `received -> processing -> processed/failed` state machine, keep `(provider, external_event_id)` dedupe, and then run Google-specific provider-state sync plus entitlement recomputation. Persist only a minimal retry-safe RTDN payload snapshot, preserve lock metadata for abandoned-work recovery, and keep the route fast enough to acknowledge receipt quickly even if provider sync has to continue through the durable processing path.
   - Which files are affected: expected changes in `src/modules/billing/repository.ts`, `src/modules/billing/service.ts`, `src/modules/billing/google-play.ts`, `src/modules/billing/routes.ts`, `src/jobs/webhook-retry.ts`, and webhook integration tests such as `test/integration/billing.google-rtdn.test.ts`.
   - Expected outcome / how to verify: the first RTDN delivery creates one durable Google `webhook_events` row, duplicate deliveries do not create extra rows, downstream sync failures leave the event retryable instead of lost, and successful processing updates the shared subscription and entitlement state.
   - Potential risks: processing before durable insert can lose Google events on transient failures; weak dedupe can double-process renewals or cancellations; missing lock metadata will prevent stale `processing` recovery later.

15. Extend the retry executor and job entrypoint so Google RTDN failures are recoverable.
   - What to do: extend `src/jobs/webhook-retry.ts` and the billing retry service path so the existing executor now retries Google RTDN-backed `webhook_events` in `received`, `failed`, and stale `processing` states. Reclaim abandoned Google `processing` rows whose `locked_at` is older than the bounded timeout, retry acknowledgment when safe, and keep the same durable retry metadata used by the Stripe path.
   - Which files are affected: expected changes in `src/jobs/webhook-retry.ts`, `src/modules/billing/service.ts`, `src/modules/billing/repository.ts`, `src/config/env.ts`, `package.json`, and retry-focused integration tests.
   - Expected outcome / how to verify: a forced RTDN processing failure leaves the Google event row retryable, running the retry job reprocesses it successfully, a stale Google `processing` row is reclaimed and completed, and safe acknowledgment retry can complete without duplicating entitlement grants.
   - Potential risks: a retry executor that only knows about Stripe will silently strand Google events; missing stale-lock recovery will let one crash permanently block provider sync; unsafe ack retry can call Google repeatedly without durable state checks.

16. Add full integration coverage and run the complete Phase 4 verification matrix.
   - What to do: register any remaining route wiring in `src/app.ts`, extend test helpers and fixtures for Google verify/restore/RTDN scenarios, update reset helpers if the new `purchase_tokens` table changes cleanup ordering, and add coverage for verify, restore, pending-state denial, linked-token replacement, acknowledgment success/failure, trusted and untrusted RTDN, duplicate RTDN dedupe, forced RTDN retry recovery, stale `processing` recovery, overlap with Stripe, and unified read routes. After that, run the full validation matrix and representative endpoint smoke flows.
   - Which files are affected: expected changes in `src/app.ts`, `test/helpers/app.ts`, `test/helpers/db.ts` if needed, and expected new or updated tests such as `test/integration/billing.google-play.test.ts`, `test/integration/billing.google-rtdn.test.ts`, `test/integration/billing.stripe.test.ts`, and `test/integration/billing.webhooks.test.ts`.
   - Expected outcome / how to verify: all locked Phase 4 routes are registered, the Google-specific test suites pass against `typetalk_test`, the existing Stripe and earlier-phase suites still pass, and the full Phase 4 verification matrix succeeds without regressing the Phase 3 billing paths.
   - Potential risks: only testing the new Google flows can hide regressions in Stripe entitlements and retry behavior; weak fixtures for trusted RTDN envelopes or acknowledgment failure will leave the most failure-prone Google paths under-verified.

### Testing Strategy

- Start with a baseline rerun before edits: `npm run build` and `npm run test`.
- After schema work, run `npx prisma validate`, `npx prisma generate`, `npx prisma migrate status`, and test-DB `npx prisma migrate deploy` to confirm the Phase 4 migration is valid and applied.
- Add targeted integration coverage for:
  - `POST /v1/billing/google-play/verify-subscription` happy path
  - verify idempotency replay with the same `Idempotency-Key`
  - verify conflict when the same key is reused with a different payload
  - pending Google provider state not granting paid access
  - `linkedPurchaseToken` upgrade/replacement handling
  - initial purchase acknowledgment after secure verification
  - acknowledgment failure leaving durable retryable ack state
  - `POST /v1/billing/google-play/restore` happy path and idempotent replay
  - `POST /v1/webhooks/google-play/rtdn` trusted delivery acceptance
  - RTDN rejection when trust verification fails
  - durable RTDN insert-before-processing behavior
  - duplicate RTDN dedupe through shared `webhook_events`
  - forced RTDN processing failure leaving the row retryable
  - retry job recovery for `received`, `failed`, and stale `processing` Google rows
  - Stripe plus Google paid overlap producing paid access with `billing_overlap=true`
  - unified `GET /v1/billing/subscription`, `GET /v1/billing/invoices`, and `GET /v1/entitlements/current` responses when Google Play is the active provider
- Run representative smoke flows after targeted tests: verify-subscription, restore, current entitlement read, billing summary read, invoice list read, trusted RTDN delivery, and retry-job execution.
- Finish with the full regression matrix: `npm run build`, `npm run test`, plus any explicit retry job command added for the webhook executor.

### Success Criteria

- `purchase_tokens` exists in Prisma and in both dev/test databases with the constraints needed for durable `purchaseToken` storage, linked-token traversal, and acknowledgment tracking.
- `POST /v1/billing/google-play/verify-subscription` exists, validates input, requires `Idempotency-Key`, verifies provider state securely, persists durable token state, and does not grant access while the provider state is pending or otherwise non-entitling.
- `POST /v1/billing/google-play/restore` exists, validates input, reuses the same durable sync path as verify, and is idempotent for repeated requests.
- Initial Google purchases are acknowledged only after successful secure verification, and a first-attempt acknowledgment failure leaves durable retryable state instead of losing the purchase.
- `POST /v1/webhooks/google-play/rtdn` exists, verifies trust/auth data before processing, stores a minimal retry-safe payload durably, acknowledges receipt quickly, and keeps failed downstream work retryable.
- The shared `webhook_events` pipeline and `src/jobs/webhook-retry.ts` process Google RTDN rows in `received`, `failed`, and stale `processing` states successfully.
- Google verify, restore, and RTDN-driven sync all update the shared billing tables so `GET /v1/billing/subscription`, `GET /v1/billing/invoices`, and `GET /v1/entitlements/current` remain unified when Google Play is the active provider.
- Stripe and Google Play overlap for the same organization preserves paid access and surfaces `billing_overlap=true`.
- The full Phase 4 build, migration, targeted integration tests, retry-job verification, and complete regression suite all pass.
