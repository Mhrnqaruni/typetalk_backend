## Phase 3 — Implementation Plan

### Changes After Review Round 1

- Inspector comment: the retry model had no recovery path for abandoned `processing` rows, so a crash after locking a webhook could leave Stripe state stuck forever. What was the issue: Steps 13 and 15 only described retries for `received` and `failed` rows and did not define stale-lock recovery for `processing` rows with old `locked_at` timestamps. What I changed: Step 2 now calls out bounded stale-lock timeout settings, Step 13 now requires the state machine to preserve enough lock metadata for abandoned-work recovery, Step 15 now explicitly requires the retry executor to reclaim stale `processing` rows whose `locked_at` is older than a bounded timeout, and the testing strategy plus success criteria now require a failure-injection test that simulates a crash after lock acquisition. Why: without stale-lock recovery, a single process crash can permanently strand a Stripe event and leave subscriptions and entitlements out of sync.
- Inspector comment: the locked `billing_overlap` rule was still not explicitly scheduled in the entitlement engine. What was the issue: the prior plan blocked duplicate checkout creation but did not require entitlement recomputation to detect and persist `billing_overlap` when more than one active paid Stripe subscription already exists for an organization. What I changed: Steps 8 and 14 now require the entitlement read model and recomputation logic to set and clear `billing_overlap`, Step 9 now notes that paid access remains paid if overlap already exists while checkout creation is still blocked, and the testing strategy plus success criteria now require a seeded dual-active-subscription test that verifies paid access with `billing_overlap=true`. Why: the final plan locks overlap handling as part of entitlement correctness, so Phase 3 has to compute it even if Stripe data becomes inconsistent or externally duplicated.
- Inspector comment: webhook payload privacy and retention were missing from the plan even though Stripe data can contain unnecessary sensitive fields. What was the issue: the earlier plan described durable `payload_json` storage but did not define whether Phase 3 stores the full Stripe event forever, stores a minimal verified snapshot, or prunes sensitive payloads. What I changed: Step 3 now defines `payload_json` as a minimal retry-safe verified snapshot rather than the full raw Stripe event, Step 13 now requires sanitization before persistence and explicitly forbids retaining raw payment-instrument data in durable webhook rows, and the testing strategy plus success criteria now require verification that persisted webhook events keep only the fields needed for retry processing. Why: this aligns Phase 3 with the locked privacy rules while still preserving enough data to reprocess Stripe events safely.

### Objective

Phase 3 adds Stripe billing for web and Windows, durable billing-state storage, retry-safe Stripe webhook processing, and the first unified entitlement API for TypeTalk. At the end of this phase, the backend must be able to seed plans, start Stripe checkout and customer-portal flows safely, ingest Stripe webhooks durably, recompute organization entitlements, and expose billing state through stable read endpoints.

### Prerequisites

- Phase 0, Phase 1, and Phase 2 must already be completed and re-verified in the current workspace.
- The current backend must still pass `npm run build` and `npm run test` before Phase 3 work starts.
- The existing auth, current-organization resolution, cursor pagination helper, and idempotency helper from Phases 1 and 2 must remain the extension points for billing work rather than being reimplemented.
- `typetalk_dev` and `typetalk_test` must already be migrated through Phase 2.
- Stripe secrets, price ids, and webhook secret variables from the locked final plan must be added to local/test env files before any live-provider integration is attempted.
- Phase 3 must not implement Google Play verification or RTDN behavior yet; that remains Phase 4 scope.

### Steps

1. Confirm the Phase 2 baseline and map the current extension points for billing.
   - What to do: rerun the current baseline, inspect `prisma/schema.prisma`, `src/app.ts`, `src/config/env.ts`, `src/lib/idempotency.ts`, `src/lib/pagination.ts`, `src/modules/organizations/service.ts`, and `test/helpers/app.ts`, and document exactly where organization context, idempotency scope generation, provider injection, and route registration already live.
   - Which files are affected: no code changes expected; review `prisma/schema.prisma`, `src/app.ts`, `src/config/env.ts`, `src/lib/idempotency.ts`, `src/lib/pagination.ts`, `src/modules/organizations/service.ts`, and `test/helpers/app.ts`.
   - Expected outcome / how to verify: `npm run build` and `npm run test` still pass before any Phase 3 edits, and there is a clear map of which existing code paths will be extended for billing, entitlements, and webhook processing.
   - Potential risks: skipping the baseline check can lead to Stripe-specific code duplicating current-organization or idempotency behavior instead of reusing the proven Phase 1 and Phase 2 paths.

2. Extend configuration, dependency, and test-harness support for Stripe and billing jobs.
   - What to do: add Stripe-related dependencies or provider abstractions, extend environment parsing for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO_MONTHLY`, `STRIPE_PRICE_ID_PRO_YEARLY`, and any bounded retry/backoff and stale-lock-timeout settings needed for the webhook retry job, and extend the app/test harness so billing services can accept an injected Stripe provider stub in tests.
   - Which files are affected: expected changes in `package.json`, `src/config/env.ts`, `.env.example`, `.env.test`, `src/app.ts`, and `test/helpers/app.ts`; expected new provider-facing files such as `src/modules/billing/stripe.ts` or `src/modules/billing/provider.ts`.
   - Expected outcome / how to verify: the app can start with validated Stripe/billing configuration, tests can run with a stubbed Stripe provider instead of live network calls, and `npm run build` still passes after the provider abstraction is introduced.
   - Potential risks: making live Stripe secrets mandatory in tests will break local verification; coupling directly to the Stripe SDK without an injectable abstraction will make route and webhook tests brittle.

3. Extend the Prisma schema for Stripe billing, entitlements, and durable webhook receipt.
   - What to do: add `plans`, `provider_customers`, `subscriptions`, `entitlements`, and `webhook_events` to `prisma/schema.prisma`, plus the enums, relations, indexes, and uniqueness constraints required by the locked Phase 3 behavior. Keep `provider_customers` and `subscriptions` organization-scoped, make `(provider, external_event_id)` unique on `webhook_events`, model the real webhook-event status machine with durable lock metadata, define `payload_json` as a minimal verified retry-safe event snapshot rather than an unlimited copy of the full raw Stripe event, and include plan/provider fields needed later by Phase 4 without forcing fake Google data into Phase 3 seeds.
   - Which files are affected: `prisma/schema.prisma`.
   - Expected outcome / how to verify: the schema now contains the exact Phase 3 tables, organization-first billing relations, retry metadata on `webhook_events`, a durable entitlement shape that can expose `billing_overlap`, and a durable webhook payload contract that excludes unnecessary sensitive Stripe fields.
   - Potential risks: incorrect uniqueness or nullability rules can break duplicate-event dedupe, duplicate-checkout protection, stale-lock recovery, or future Google Play expansion.

4. Create, inspect, and apply the Phase 3 migration.
   - What to do: generate the Phase 3 migration, inspect the SQL before applying it, run it against `typetalk_dev`, and verify the same migration path against `typetalk_test`.
   - Which files are affected: `prisma/migrations/<timestamp>_phase3_stripe_billing/*`, and `prisma/migration_lock.toml` only if Prisma updates it.
   - Expected outcome / how to verify: `npx prisma migrate dev` succeeds, the generated SQL contains the expected Phase 3 tables and constraints, `npx prisma migrate status` reports dev up to date, and test-DB `prisma migrate deploy` succeeds with no pending migrations.
   - Potential risks: a faulty migration blocks the whole phase; the biggest failure modes are malformed enum defaults, missing unique constraints on `webhook_events`, and broken foreign keys back to `organizations`, `users`, or `plans`.

5. Add seed infrastructure and seed the canonical plan catalog.
   - What to do: create `prisma/seed.ts`, add or update the seed script in `package.json`, and seed exactly the locked plans `free`, `pro_monthly`, and `pro_yearly` as the backend source of truth for plan metadata, trial days, quota policy, and Stripe price mapping. Use database upserts so repeated seeding is safe and preserve the rule that billing plans come from the database instead of scattered route constants.
   - Which files are affected: expected new `prisma/seed.ts`, plus updates to `package.json` and possibly `src/config/env.ts` if the seed uses env-backed Stripe price ids.
   - Expected outcome / how to verify: `npx prisma db seed` succeeds, the three plan rows exist with the expected codes, and later read routes can load plans from the database without fallback constants.
   - Potential risks: one-off insert-only seed logic can cause duplicate rows or drift between local/test environments; hardcoding plan data in route handlers would violate the locked Phase 3 design.

6. Create the billing and entitlements module skeletons plus the Stripe-provider abstraction.
   - What to do: add the new module structure for billing and entitlements, including repository, service, schema, and route layers, and create a Stripe-provider abstraction that supports checkout-session creation, customer-portal creation, invoice listing, webhook signature verification, and event parsing without binding the whole app to live Stripe calls.
   - Which files are affected: expected new files `src/modules/billing/repository.ts`, `src/modules/billing/service.ts`, `src/modules/billing/schemas.ts`, `src/modules/billing/routes.ts`, `src/modules/billing/provider.ts`, `src/modules/billing/stripe.ts`, `src/modules/entitlements/repository.ts`, `src/modules/entitlements/service.ts`, and `src/modules/entitlements/routes.ts`, plus `src/app.ts` and `test/helpers/app.ts`.
   - Expected outcome / how to verify: the project compiles with the new module boundaries in place, the app can inject a real or stub Stripe provider, and the route-registration path is ready for incremental endpoint implementation.
   - Potential risks: putting all billing and entitlement logic into one service file will make webhook processing and read-model tests hard to isolate; missing provider abstraction will force fragile networked integration tests.

7. Implement `GET /v1/billing/plans` as a database-backed read route.
   - What to do: add the plans read path that loads active plans from the `plans` table, normalizes the response shape for clients, and keeps price/trial/quota values sourced from seeded database rows rather than constants inside the service layer.
   - Which files are affected: expected changes in `src/modules/billing/repository.ts`, `src/modules/billing/service.ts`, `src/modules/billing/schemas.ts`, `src/modules/billing/routes.ts`, and a new billing integration test file such as `test/integration/billing.stripe.test.ts`.
   - Expected outcome / how to verify: `GET /v1/billing/plans` returns the active seeded plan set and remains stable after reseeding, and tests confirm the response is sourced from the database.
   - Potential risks: returning plan metadata from constants instead of the database will create drift between seeded plan rows and the API.

8. Implement `GET /v1/entitlements/current` and the initial `GET /v1/billing/subscription` read model.
   - What to do: add the unified entitlement read path and the current subscription-summary route for the authenticated current organization. Before any paid state exists, both routes should resolve correctly for the default free state; after Stripe subscription rows exist, they must reflect trial, active paid, grace, payment issue, expired, or suspended states based on the stored entitlement/subscription model, and the entitlement read path must surface `billing_overlap` when more than one active paid subscription exists for the same organization.
   - Which files are affected: expected changes in `src/modules/entitlements/repository.ts`, `src/modules/entitlements/service.ts`, `src/modules/entitlements/routes.ts`, `src/modules/billing/repository.ts`, `src/modules/billing/service.ts`, `src/modules/billing/routes.ts`, `src/app.ts`, and new integration coverage in `test/integration/entitlements.test.ts` or `test/integration/billing.stripe.test.ts`.
   - Expected outcome / how to verify: a signed-in user can call both routes, see the correct free default before any billing activity, later see Stripe-derived subscription and entitlement data for their personal organization, and observe `billing_overlap=true` when seeded overlapping paid subscriptions exist.
   - Potential risks: resolving billing state by user instead of current organization will break future workspace-ready behavior and conflict with the locked entitlement rules, especially once overlap detection is introduced.

9. Implement `POST /v1/billing/stripe/checkout-session` with actor-scoped idempotency, trial handling, and duplicate-paid-checkout blocking.
   - What to do: add the authenticated checkout-session route, require `Idempotency-Key`, validate the requested paid plan, create or reuse the Stripe customer for the current organization, apply the 30-day Pro trial rule when eligible, and block checkout creation when the current organization already has an active paid entitlement. If overlapping paid Stripe subscriptions already exist because of external provider state, preserve paid access and `billing_overlap` in the entitlement model while still refusing to create another checkout. Reuse the Phase 2 `idempotency_keys` infrastructure so the same key and payload replay safely while a changed payload returns conflict.
   - Which files are affected: expected changes in `src/modules/billing/schemas.ts`, `src/modules/billing/repository.ts`, `src/modules/billing/service.ts`, `src/modules/billing/routes.ts`, `src/lib/idempotency.ts` only if a shared helper extension is needed, and billing integration tests under `test/integration/billing.stripe.test.ts`.
   - Expected outcome / how to verify: the first valid request creates one Stripe checkout session response, the same key plus same payload replays the stored response, the same key plus different payload returns conflict, duplicate paid checkout is blocked when a paid entitlement already exists, and trial eligibility is reflected in the created checkout metadata or resulting subscription state.
   - Potential risks: weak idempotency or customer upsert logic can create duplicate Stripe sessions or duplicate provider-customer rows; missing entitlement pre-checks can allow duplicate billing despite the locked rules.

10. Implement `POST /v1/billing/stripe/customer-portal`.
   - What to do: add the authenticated portal-session route for the current organization, resolve or validate the Stripe customer mapping, and return a provider-generated portal URL without exposing provider secrets.
   - Which files are affected: expected changes in `src/modules/billing/schemas.ts`, `src/modules/billing/repository.ts`, `src/modules/billing/service.ts`, `src/modules/billing/routes.ts`, and billing integration tests.
   - Expected outcome / how to verify: an organization with a Stripe customer can request a customer-portal session successfully, and missing or invalid Stripe-customer state is handled with a safe application error.
   - Potential risks: creating portal sessions without validating organization ownership can leak billing management URLs across accounts.

11. Implement `GET /v1/billing/invoices` with the shared cursor-pagination contract.
   - What to do: add the invoices list route for the authenticated current organization, normalize provider invoice data into the API's shared `items` plus `next_cursor` shape, and keep the route Stripe-only in Phase 3 while structuring the service so Phase 4 can extend it for Google-backed billing summaries later.
   - Which files are affected: expected changes in `src/modules/billing/schemas.ts`, `src/modules/billing/service.ts`, `src/modules/billing/routes.ts`, the Stripe-provider abstraction, and billing integration tests.
   - Expected outcome / how to verify: `GET /v1/billing/invoices?limit=...&cursor=...` returns a paginated invoice list for the current organization and follows the shared pagination contract already used elsewhere in the codebase.
   - Potential risks: leaking raw provider cursor tokens or using a route shape that differs from the shared pagination contract will make the billing API inconsistent with the rest of the backend.

12. Add raw-body webhook infrastructure and implement `POST /v1/webhooks/stripe` signature verification.
   - What to do: add the route-specific raw-body handling required for Stripe signature verification, ensure the webhook path uses the explicit webhook body limit instead of the default JSON route behavior, and reject invalid signatures before any business processing happens.
   - Which files are affected: expected changes in `src/app.ts`, `src/modules/billing/routes.ts`, `src/modules/billing/stripe.ts` or `src/modules/billing/provider.ts`, and webhook-focused tests such as `test/integration/billing.webhooks.test.ts`.
   - Expected outcome / how to verify: valid signed webhook payloads are accepted, invalid or tampered signatures are rejected, and the raw request body is preserved exactly enough for Stripe verification.
   - Potential risks: letting Fastify parse and mutate the JSON body before signature verification will break Stripe validation and can produce false negatives in production.

13. Implement durable webhook receipt, dedupe, and the insert-first processing state machine.
   - What to do: add the repository and service path that inserts or upserts a `webhook_events` row before business processing, uses the locked `received -> processing -> processed/failed` state machine, increments attempts, stores retry metadata, sanitizes the verified Stripe event into a minimal retry-safe `payload_json` snapshot before persistence, and keeps duplicate-event delivery retry-safe instead of destructive. Preserve enough metadata on `processing` rows for the retry executor to detect and recover abandoned work after a crash.
   - Which files are affected: expected changes in `src/modules/billing/repository.ts`, `src/modules/billing/service.ts`, `src/modules/billing/routes.ts`, `src/modules/billing/stripe.ts` or `src/modules/billing/provider.ts`, and webhook integration tests.
   - Expected outcome / how to verify: the first webhook delivery creates one durable row with a sanitized minimal payload snapshot, duplicate deliveries do not create extra rows, event-state transitions are stored durably without losing retryability, and the stored payload excludes raw payment-instrument details that are not needed for retry processing.
   - Potential risks: processing before persistence can lose provider events on transient failures; naive duplicate handling can incorrectly mark unprocessed events as finished; storing the full raw Stripe object forever can violate the locked privacy posture.

14. Implement Stripe event processing, subscription updates, entitlement recomputation, and 30-day trial persistence.
   - What to do: handle the Stripe event types required to keep subscription and entitlement state correct, map provider events to `subscriptions`, `provider_customers`, and `entitlements`, persist trial flags and `trial_ends_at`, update paid/grace/payment-issue/expired states, and preserve the rule that entitlements are computed primarily per organization. During recomputation, detect when more than one active paid Stripe subscription exists for the same organization, keep access paid, set `billing_overlap=true`, and clear that flag again when the overlap no longer exists.
   - Which files are affected: expected changes in `src/modules/billing/service.ts`, `src/modules/billing/repository.ts`, `src/modules/entitlements/service.ts`, `src/modules/entitlements/repository.ts`, the Stripe-provider abstraction, and billing/entitlement integration tests.
   - Expected outcome / how to verify: relevant Stripe events move the organization from free to trial or paid states correctly, `GET /v1/billing/subscription` reflects the updated provider state, `GET /v1/entitlements/current` exposes the recomputed entitlement code for the same organization, and overlap scenarios surface `billing_overlap=true` without dropping paid access.
   - Potential risks: incomplete event mapping can leave entitlements stale even when subscription rows update; failing to detect overlap will produce incorrect warnings and state even if access remains paid.

15. Implement the webhook retry executor and Railway-cron entrypoint for `received` and `failed` events.
   - What to do: add a retry job that scans `webhook_events` in `received` and `failed` states, locks eligible rows safely, retries processing, updates `attempt_count`, `locked_at`, `last_error`, and `next_retry_at`, and exposes a command path suitable for Railway cron execution. The executor must also reclaim stale `processing` rows whose `locked_at` is older than a bounded timeout by moving them back into retry eligibility or otherwise treating them as recoverable abandoned work.
   - Which files are affected: expected new files such as `src/jobs/webhook-retry.ts` and possibly a thin job runner in `src/server.ts` or a dedicated script entrypoint, plus updates to `package.json`, `src/modules/billing/service.ts`, `src/modules/billing/repository.ts`, and webhook retry tests.
   - Expected outcome / how to verify: a forced Stripe webhook-processing failure leaves the row in a retryable state, running the retry job reprocesses it successfully, a stale `processing` row left behind by a simulated crash is reclaimed and completed, and the event ends in `processed` with retry metadata updated correctly.
   - Potential risks: missing row locking can double-process the same event; an executor that only handles `failed` but not `received` or stale `processing` rows will violate the locked retry model from the master plan.

16. Register the new modules, add end-to-end test coverage, and run the full Phase 3 verification matrix.
   - What to do: register the billing and entitlements routes in `src/app.ts`, extend the test harness for Stripe stubs and webhook payload helpers, update test reset helpers if any new table ordering is required, add integration coverage for plans, entitlements, checkout, portal, invoices, webhooks, retries, and duplicate-paid-checkout blocking, then rerun the full project validation matrix plus representative billing smoke flows.
   - Which files are affected: `src/app.ts`, `test/helpers/app.ts`, `test/helpers/db.ts` if needed, expected new tests such as `test/integration/billing.stripe.test.ts`, `test/integration/billing.webhooks.test.ts`, and `test/integration/entitlements.test.ts`, plus any helper files needed for Stripe event fixtures.
   - Expected outcome / how to verify: all Phase 3 routes are reachable through the application, the new Stripe-focused test suites pass against `typetalk_test`, and the full existing Phase 1 and Phase 2 suites still pass after the billing modules are introduced.
   - Potential risks: only running targeted new tests can hide regressions in auth, organizations, or device sync; missing test fixtures for signed raw-body webhook payloads can leave the most sensitive billing path under-verified.

### Testing Strategy

- Run schema and migration verification first:
  - `npx prisma validate`
  - `npx prisma generate`
  - `npx prisma migrate dev --name phase3_stripe_billing`
  - apply the same migration path to `typetalk_test`
  - `npx prisma db seed`
- Run targeted automated tests for the new Phase 3 surfaces:
  - `GET /v1/billing/plans` returns seeded data from the database, not route constants
  - `GET /v1/entitlements/current` returns the free default before any paid subscription exists
  - `GET /v1/billing/subscription` returns the correct organization-scoped summary before and after Stripe events
  - `POST /v1/billing/stripe/checkout-session` happy path
  - `POST /v1/billing/stripe/checkout-session` requires `Idempotency-Key`
  - `POST /v1/billing/stripe/checkout-session` replays the stored response for the same key plus same payload
  - `POST /v1/billing/stripe/checkout-session` returns conflict for the same key plus different payload
  - `POST /v1/billing/stripe/checkout-session` blocks a second paid checkout when the organization already has an active paid entitlement
  - seeding two active paid Stripe subscriptions for one organization keeps access paid and sets `billing_overlap=true`
  - `POST /v1/billing/stripe/customer-portal` returns a portal session for an organization with a Stripe customer
  - `GET /v1/billing/invoices` follows `limit`, `cursor`, `items`, and `next_cursor`
  - `POST /v1/webhooks/stripe` rejects invalid signatures and accepts valid signed raw-body payloads
  - duplicate Stripe webhook deliveries dedupe safely on `(provider, external_event_id)`
  - webhook events are inserted before processing and follow `received`, `processing`, `processed`, and `failed`
  - persisted `webhook_events.payload_json` stores only the minimal verified retry snapshot and excludes unnecessary sensitive Stripe payment fields
  - a forced webhook-processing failure leaves the event retryable with `last_error` and `next_retry_at`
  - running the retry executor processes eligible `received` and `failed` rows successfully
  - a simulated crash after a row is marked `processing` leaves a stale lock that the retry executor later reclaims and completes successfully
  - Stripe event processing updates `subscriptions`, `provider_customers`, and `entitlements` correctly for free, trial, active paid, payment-issue, and expired scenarios that are in scope for Phase 3
- Run the full automated suite against `typetalk_test` after the targeted billing tests:
  - all existing Phase 1 suites
  - all existing Phase 2 suites
  - all new Phase 3 billing and entitlement suites
- Run manual or scripted API smoke checks for representative Phase 3 routes:
  - `GET /v1/billing/plans`
  - `GET /v1/billing/subscription`
  - `POST /v1/billing/stripe/checkout-session`
  - `POST /v1/billing/stripe/customer-portal`
  - `GET /v1/billing/invoices`
  - `POST /v1/webhooks/stripe`
  - `GET /v1/entitlements/current`
  - the webhook retry job entrypoint
- Confirm Phase 3 API-contract details explicitly:
  - billing plans come from the database
  - billing reads are scoped to the authenticated current organization
  - `GET /v1/billing/invoices` uses the shared cursor-pagination contract
  - checkout creation is idempotent and duplicate-paid-checkout blocking works
  - overlap in paid Stripe subscriptions keeps access paid and sets `billing_overlap=true`
  - Stripe webhooks are raw-body verified, inserted first, retry-safe, and recoverable by the retry executor
  - stale `processing` webhook rows are recoverable after a bounded lock timeout
  - persisted Stripe webhook payloads are sanitized minimal snapshots, not unlimited full raw events
  - no Phase 3 route stores raw audio, raw transcript text, or raw payment instrument data

### Success Criteria

- Prisma schema and migration exist for all locked Phase 3 tables: `plans`, `provider_customers`, `subscriptions`, `entitlements`, and `webhook_events`.
- `prisma/seed.ts` exists and safely seeds the canonical `free`, `pro_monthly`, and `pro_yearly` plans.
- `GET /v1/billing/plans`, `GET /v1/billing/subscription`, `POST /v1/billing/stripe/checkout-session`, `POST /v1/billing/stripe/customer-portal`, `GET /v1/billing/invoices`, `POST /v1/webhooks/stripe`, and `GET /v1/entitlements/current` are implemented and verified.
- `GET /v1/billing/plans` returns plan metadata from the database instead of scattered constants.
- Stripe checkout creation is actor-scoped and idempotent: the same key plus same payload replays safely, and the same key plus different payload returns conflict.
- Stripe checkout creation refuses to start when the current organization already has an active paid entitlement.
- The 30-day Pro trial rule is implemented and persisted in Stripe-backed subscription state and entitlement recomputation.
- The entitlement engine sets `billing_overlap=true` when more than one active paid Stripe subscription exists for the same organization and clears it again when overlap is resolved.
- `GET /v1/billing/invoices` follows the shared `limit`, `cursor`, `items`, and `next_cursor` contract.
- `POST /v1/webhooks/stripe` verifies the raw Stripe signature before processing, inserts the event row before downstream work, dedupes on `(provider, external_event_id)`, and preserves retryability.
- The webhook-processing state machine uses real durable states: `received`, `processing`, `processed`, and `failed`.
- Durable `webhook_events.payload_json` rows store only the minimal verified snapshot needed for retry processing and do not retain raw payment-instrument data.
- A Railway-cron-compatible retry executor exists and successfully reprocesses `webhook_events` in `received`, `failed`, and stale `processing` recovery scenarios after forced failures.
- `GET /v1/entitlements/current` returns the correct organization-scoped free, trial, or Stripe-paid result after billing changes.
- The full automated suite, including existing Phase 1 and Phase 2 coverage plus the new Phase 3 billing coverage, passes against `typetalk_test`.
