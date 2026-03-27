## Phase 3 — Execution Report

### Fixes Applied — Review Round 1

- Issue: mixed-status overlap could wrongly downgrade a still-paid organization when one subscription was `ACTIVE` and another later-ending overlapping subscription was `PAYMENT_ISSUE`, `GRACE`, or `TRIALING`. Did I confirm it: yes. I confirmed it by reading `src/modules/entitlements/service.ts`, which selected the primary subscription from the repository sort order instead of explicit entitlement precedence, and by adding regression tests in `test/integration/billing.stripe.test.ts` that initially failed for `ACTIVE + PAYMENT_ISSUE`, `ACTIVE + GRACE`, and `ACTIVE + TRIALING`. What I fixed: I updated `src/modules/entitlements/service.ts` to use explicit subscription precedence when recomputing entitlements, so overlapping paid states preserve the strongest valid paid access while still setting `billing_overlap=true` separately. How I verified: the new mixed-status regression tests now pass, `npm run build` passes, and the full suite passes.
- Issue: `GET /v1/entitlements/current` could return `free` when an active Stripe subscription existed but no durable entitlement row had been written yet. Did I confirm it: yes. I confirmed it by reading the old missing-row branch in `src/modules/entitlements/service.ts`, which returned a hardcoded free default instead of recomputing, and by adding an entitlements-first regression test in `test/integration/billing.stripe.test.ts` that initially failed. What I fixed: I added a shared resolved-entitlement path in `src/modules/entitlements/service.ts` that recomputes and persists the current entitlement when the row is missing, and I updated `src/modules/billing/service.ts` to use that same resolved-entitlement path for subscription summaries so both endpoints share the same source of truth. How I verified: the new entitlements-first regression test passes, `GET /v1/entitlements/current` now creates the durable entitlement row from subscription state, and the full suite passes.
- Issue: Phase 3 coverage did not exercise the edge cases above, so the bug survived the original Phase 3 verification matrix. Did I confirm it: yes. I confirmed it by re-reading `test/integration/billing.stripe.test.ts`, which only covered two `ACTIVE` overlaps and hit `/v1/billing/subscription` before `/v1/entitlements/current`. What I fixed: I expanded `test/integration/billing.stripe.test.ts` with explicit mixed-status overlap coverage and an entitlements-first missing-row regression. How I verified: `npx vitest run test/integration/billing.stripe.test.ts` now passes with the new cases included.
- Additional verification fix uncovered while applying the review: `src/jobs/webhook-retry.ts` still instantiated `BillingService` with the old constructor signature after the entitlement-service refactor. Did I confirm it: yes. `npm run build` failed immediately with a constructor-arity error, and the broken runtime wiring also caused the webhook retry tests to fail. What I fixed: I updated `src/jobs/webhook-retry.ts` to construct `BillingService` with the current argument list and kept the retry entrypoint aligned with the live app wiring. How I verified: `npm run build`, `npx vitest run test/integration/billing.webhooks.test.ts`, `npm run test`, and `npm run billing:webhooks:retry` all pass.

### Summary

Phase 3 was executed end to end and Review Round 1 closed the remaining entitlement edge cases. This phase added Stripe billing for web and Windows, seeded database-backed plan metadata, implemented unified billing and entitlement read models, introduced durable Stripe webhook receipt and retry processing, and added the first organization-scoped entitlement engine for TypeTalk.

The main implementation landed in the Phase 3 Prisma schema and migration, `prisma/seed.ts`, the new `src/modules/billing/*` and `src/modules/entitlements/*` modules, the retry job at `src/jobs/webhook-retry.ts`, and expanded billing integration coverage in `test/integration/billing.stripe.test.ts` and `test/integration/billing.webhooks.test.ts`. Final verification after the review fixes passed with a clean TypeScript build, the targeted Stripe billing regressions, the targeted webhook retry suite, the full existing suite against `typetalk_test`, and a direct run of the webhook-retry entrypoint.

### Step-by-Step Execution Log

#### Step 1: Confirm the Phase 2 baseline and map the current extension points for billing

Action taken: Re-ran the current baseline before any Phase 3 edits, inspected the Phase 2 extension points in `prisma/schema.prisma`, `src/app.ts`, `src/config/env.ts`, `src/lib/idempotency.ts`, `src/lib/pagination.ts`, `src/modules/organizations/service.ts`, and `test/helpers/app.ts`, and mapped where organization context, idempotency scope generation, provider injection, and route registration already lived. The initial baseline failed because the expected temporary PostgreSQL cluster on `127.0.0.1:55432` was down, so I removed the stale `postmaster.pid`, restarted the existing `.tmp/postgres/data` cluster on port `55432`, and then reran the baseline.

Files modified:
None.

Verification: `pg_isready -h 127.0.0.1 -p 55432` returned accepting connections after the restart. `npm run build`, `npm run test`, and `npx prisma migrate status` then passed on the recovered Phase 2 baseline, and the inspected files confirmed that current-organization resolution, cursor pagination, and shared idempotency were ready to extend.

Status: DONE_WITH_DEVIATION

#### Step 2: Extend configuration, dependency, and test-harness support for Stripe and billing jobs

Action taken: Added the Stripe SDK dependency, extended env parsing for Stripe keys, price ids, retry/backoff settings, and stale-lock timeout settings, and expanded the app/test harness so billing services can run against an injected provider stub in tests instead of live Stripe calls.

Files modified:
`package.json` - added the `stripe` dependency, the seed command, and the webhook retry job script.
`.env.example` - documented the Phase 3 Stripe and retry-related environment variables.
`.env.local` - added local Phase 3 billing configuration.
`.env.test` - added test billing configuration for `typetalk_test`.
`src/config/env.ts` - parsed and validated Stripe and billing-job settings.
`src/app.ts` - accepted Stripe provider injection and billing module wiring.
`src/modules/billing/provider.ts` - defined the provider abstraction used by the service layer.
`test/helpers/app.ts` - added the stub Stripe provider path for integration tests.
`test/lib/email-provider.test.ts` - updated the harness shape after app dependency expansion.

Verification: `npm install stripe` completed successfully and `npm run build` passed after the provider abstraction and env changes were introduced. Test helpers could now boot the app with a stub Stripe provider and without live network dependency.

Status: DONE

#### Step 3: Extend the Prisma schema for Stripe billing, entitlements, and durable webhook receipt

Action taken: Added the Phase 3 billing schema to `prisma/schema.prisma`, including `plans`, `provider_customers`, `subscriptions`, `entitlements`, and `webhook_events`, plus the required enums, indexes, relations, uniqueness constraints, retry metadata, and organization-scoped billing links. The webhook payload contract was defined as a minimal retry-safe snapshot rather than unlimited raw Stripe JSON, and the subscription and entitlement models included the fields needed for trial state and `billing_overlap`.

Files modified:
`prisma/schema.prisma` - added the Phase 3 enums, tables, relations, indexes, and durable webhook state fields.

Verification: `npx prisma format` and `npx prisma validate` both passed. The resulting schema included the exact locked Phase 3 tables, the unique `(provider, external_event_id)` constraint on `webhook_events`, and the state-machine and overlap fields required by the approved plan.

Status: DONE

#### Step 4: Create, inspect, and apply the Phase 3 migration

Action taken: Generated the Phase 3 migration, inspected the SQL, applied it to `typetalk_dev`, and replayed the same migration path against `typetalk_test`.

Files modified:
`prisma/migrations/20260326034234_phase3_stripe_billing/migration.sql` - created the Phase 3 tables, enums, indexes, and foreign keys.
`prisma/migrations/migration_lock.toml` - updated Prisma migration lock metadata.

Verification: `npx prisma migrate dev --name phase3_stripe_billing` succeeded, `npx prisma migrate status` reported the dev database up to date, and `DATABASE_URL=postgresql://postgres@127.0.0.1:55432/typetalk_test?schema=public npx prisma migrate deploy` completed successfully for the test database.

Status: DONE

#### Step 5: Add seed infrastructure and seed the canonical plan catalog

Action taken: Created the seed entrypoint and seeded the canonical `free`, `pro_monthly`, and `pro_yearly` plans as database-backed source of truth for billing metadata, trial days, and Stripe price mapping. The seed logic uses upserts so repeated seeding is safe and later route reads do not depend on hardcoded plan constants.

Files modified:
`prisma/seed.ts` - added seed helpers and CLI entrypoint for canonical billing plan rows.
`package.json` - configured `prisma db seed` to run `tsx prisma/seed.ts`.

Verification: `npx prisma db seed` succeeded, and direct database verification confirmed the seeded plan rows and expected codes existed for `free`, `pro_monthly`, and `pro_yearly`.

Status: DONE

#### Step 6: Create the billing and entitlements module skeletons plus the Stripe-provider abstraction

Action taken: Added repository, service, schema, and route layers for billing and entitlements, introduced the live Stripe provider implementation, and wired the module boundaries so the app can inject either a real provider or the test stub.

Files modified:
`src/modules/billing/schemas.ts` - added request and response schema definitions for billing routes.
`src/modules/billing/repository.ts` - added billing persistence boundaries for plans, customers, subscriptions, webhook rows, and invoices.
`src/modules/billing/service.ts` - added billing orchestration logic.
`src/modules/billing/routes.ts` - added the billing route-registration layer.
`src/modules/billing/provider.ts` - defined the provider abstraction contract.
`src/modules/billing/stripe.ts` - implemented the live Stripe-backed provider.
`src/modules/entitlements/repository.ts` - added entitlement persistence helpers.
`src/modules/entitlements/service.ts` - added organization-scoped entitlement computation and read logic.
`src/modules/entitlements/routes.ts` - added entitlement route registration.
`src/app.ts` - wired repositories, services, providers, and route registration.

Verification: `npm run build` passed with the new module boundaries in place, and the app bootstrap path could construct either the live Stripe provider or the stub provider used in tests.

Status: DONE

#### Step 7: Implement `GET /v1/billing/plans` as a database-backed read route

Action taken: Added the public billing-plans read path so the API loads active plans from the `plans` table and returns normalized client-facing plan metadata from seeded database rows rather than service-layer constants.

Files modified:
`src/modules/billing/repository.ts` - added active-plan queries from the database.
`src/modules/billing/service.ts` - added plan response mapping.
`src/modules/billing/routes.ts` - added `GET /v1/billing/plans`.
`test/integration/billing.stripe.test.ts` - added plan-route coverage against seeded rows.

Verification: the targeted Phase 3 stripe test suite passed and asserted that `GET /v1/billing/plans` returns the seeded plan set from the database.

Status: DONE

#### Step 8: Implement `GET /v1/entitlements/current` and the initial `GET /v1/billing/subscription` read model

Action taken: Added the organization-scoped entitlement read path and the current subscription-summary route. The implementation returns the free default before any paid billing state exists, reads current organization billing state after subscription rows are created, and exposes `billing_overlap` when more than one active paid Stripe subscription exists for the same organization.

Files modified:
`src/modules/entitlements/repository.ts` - added current-entitlement lookup and recompute support.
`src/modules/entitlements/service.ts` - added free default resolution and overlap-aware entitlement mapping.
`src/modules/entitlements/routes.ts` - added `GET /v1/entitlements/current`.
`src/modules/billing/repository.ts` - added current-subscription read helpers.
`src/modules/billing/service.ts` - added organization-scoped subscription-summary logic.
`src/modules/billing/routes.ts` - added `GET /v1/billing/subscription`.
`test/integration/billing.stripe.test.ts` - added free-default and overlap-aware read-model coverage.

Verification: the Phase 3 stripe test suite passed for the free default, seeded active paid state, and seeded overlapping paid subscription scenarios, including `billing_overlap=true`.

Status: DONE

#### Step 9: Implement `POST /v1/billing/stripe/checkout-session` with actor-scoped idempotency, trial handling, and duplicate-paid-checkout blocking

Action taken: Added the authenticated Stripe checkout-session route, required `Idempotency-Key`, reused the Phase 2 shared idempotency helper, created or reused the organization-scoped Stripe customer mapping, applied the 30-day Pro trial when eligible, and blocked checkout creation when the current organization already had an active paid entitlement. If overlapping paid provider state already existed, the route still refused to create another checkout while leaving paid access and `billing_overlap` intact.

Files modified:
`src/modules/billing/schemas.ts` - added checkout request validation and response shape.
`src/modules/billing/repository.ts` - added provider-customer persistence and entitlement pre-check helpers.
`src/modules/billing/service.ts` - added checkout creation, idempotent replay/conflict handling, trial mapping, and duplicate-paid blocking.
`src/modules/billing/routes.ts` - added `POST /v1/billing/stripe/checkout-session`.
`test/integration/billing.stripe.test.ts` - added checkout idempotency, trial, and duplicate-paid-blocking coverage.

Verification: the targeted billing stripe tests passed for required `Idempotency-Key`, same-key same-payload replay, same-key different-payload conflict, 30-day trial metadata, and duplicate-paid-checkout blocking.

Status: DONE

#### Step 10: Implement `POST /v1/billing/stripe/customer-portal`

Action taken: Added the authenticated customer-portal route for the current organization, resolved the correct Stripe customer mapping, and returned a provider-generated portal URL without exposing provider secrets.

Files modified:
`src/modules/billing/schemas.ts` - added portal-session response schema.
`src/modules/billing/repository.ts` - added provider-customer lookup for portal creation.
`src/modules/billing/service.ts` - added customer-portal session orchestration.
`src/modules/billing/routes.ts` - added `POST /v1/billing/stripe/customer-portal`.
`test/integration/billing.stripe.test.ts` - added customer-portal route coverage.

Verification: the targeted Phase 3 billing suite passed for the customer-portal flow for an organization with a Stripe customer mapping.

Status: DONE

#### Step 11: Implement `GET /v1/billing/invoices` with the shared cursor-pagination contract

Action taken: Added the paginated invoice-list route for the authenticated current organization, normalized provider invoice data into the shared `items` and `next_cursor` response contract, and kept the service Stripe-only while preserving a later extension point for Phase 4.

Files modified:
`src/modules/billing/schemas.ts` - added invoice query parsing and response mapping.
`src/modules/billing/service.ts` - added invoice pagination orchestration.
`src/modules/billing/routes.ts` - added `GET /v1/billing/invoices`.
`src/modules/billing/provider.ts` - extended the provider contract for paginated invoice reads.
`src/modules/billing/stripe.ts` - implemented invoice listing in the live provider.
`test/integration/billing.stripe.test.ts` - added shared cursor-pagination coverage for invoices.

Verification: the targeted Phase 3 billing suite passed and asserted the expected `limit`, `cursor`, `items`, and `next_cursor` behavior for invoice listing.

Status: DONE

#### Step 12: Add raw-body webhook infrastructure and implement `POST /v1/webhooks/stripe` signature verification

Action taken: Added the raw-body path required for Stripe webhook signature verification, ensured the Stripe webhook route uses the explicit webhook body limit instead of the normal JSON path, and rejected invalid signatures before any billing business logic runs.

Files modified:
`src/app.ts` - enabled the route-specific raw-body handling needed for Stripe verification.
`src/modules/billing/routes.ts` - added `POST /v1/webhooks/stripe` and bound the raw-body path.
`src/modules/billing/stripe.ts` - added signature-verification and event-parsing support.
`test/integration/billing.webhooks.test.ts` - added valid and invalid signature coverage.

Verification: the webhook integration suite passed and confirmed that tampered signatures are rejected while valid signed raw-body payloads are accepted.

Status: DONE

#### Step 13: Implement durable webhook receipt, dedupe, and the insert-first processing state machine

Action taken: Added the insert-first durable webhook receipt path so verified Stripe events are persisted before downstream business processing, deduped on `(provider, external_event_id)`, and transitioned through the real durable states `received`, `processing`, `processed`, and `failed`. Persisted webhook payloads are sanitized into a minimal retry-safe snapshot rather than an unlimited raw Stripe event.

Files modified:
`src/modules/billing/repository.ts` - added webhook row insert/upsert, locking, and state-transition persistence.
`src/modules/billing/service.ts` - added durable webhook-receipt and state-machine logic.
`src/modules/billing/routes.ts` - wired request handling through the insert-first flow.
`src/modules/billing/stripe.ts` - added sanitized payload mapping from verified Stripe events.
`test/integration/billing.webhooks.test.ts` - added state-machine, dedupe, and payload-sanitization coverage.

Verification: the webhook suite passed and verified that the first delivery creates one durable row, duplicate deliveries do not create extra rows, state transitions are stored durably, and persisted `payload_json` keeps only the fields required for retry processing.

Status: DONE

#### Step 14: Implement Stripe event processing, subscription updates, entitlement recomputation, and 30-day trial persistence

Action taken: Implemented the Stripe event-processing path that updates provider customers, subscriptions, and entitlements from verified Stripe events; persists trial state and `trial_ends_at`; updates paid, payment-issue, and expired billing states in Phase 3 scope; and recomputes organization-scoped entitlement state including `billing_overlap` set and clear behavior.

Files modified:
`src/modules/billing/repository.ts` - added provider-customer and subscription update paths.
`src/modules/billing/service.ts` - added Stripe event handling, subscription-state mapping, and handoff into entitlement recomputation.
`src/modules/entitlements/repository.ts` - added entitlement upsert and overlap-aware lookup helpers.
`src/modules/entitlements/service.ts` - added overlap-aware recomputation and unified entitlement serialization.
`test/integration/billing.stripe.test.ts` - added trial and overlap read-model coverage.
`test/integration/billing.webhooks.test.ts` - added webhook-driven subscription and entitlement update coverage.

Verification: the targeted Phase 3 suites passed for trial creation, subscription-state updates after Stripe events, paid and free entitlement resolution, and seeded dual-active-subscription overlap with `billing_overlap=true`.

Status: DONE

#### Step 15: Implement the webhook retry executor and Railway-cron entrypoint for `received` and `failed` events

Action taken: Added the retry executor and Railway-cron-compatible entrypoint that scans `webhook_events` in `received`, `failed`, and stale `processing` states, locks eligible rows safely, updates retry metadata, reprocesses the event through the same billing path, and reclaims abandoned `processing` rows whose `locked_at` is older than the configured timeout.

Files modified:
`src/jobs/webhook-retry.ts` - added the CLI entrypoint and job runner for Railway cron use.
`src/modules/billing/repository.ts` - added retry candidate queries, locking, and retry-state persistence.
`src/modules/billing/service.ts` - added retry execution and stale-lock recovery behavior.
`package.json` - added the `billing:webhooks:retry` script.
`test/integration/billing.webhooks.test.ts` - added retry, failure, and stale-processing recovery coverage.

Verification: `npm run billing:webhooks:retry` executed successfully and returned a zero-work summary on the clean database. The webhook suite passed for forced failure, retryable `failed` rows, `received`-row processing, and stale `processing` lock recovery.

Status: DONE

#### Step 16: Register the new modules, add end-to-end test coverage, and run the full Phase 3 verification matrix

Action taken: Completed route registration in the application bootstrap, updated test reset helpers for the new billing tables, added the new Stripe-focused integration suites, and ran the Phase 3 verification matrix across Prisma checks, database migration checks, the targeted billing suites, the full existing suite, and the webhook-retry job entrypoint. I also attempted a separate ad hoc scripted smoke flow for representative Phase 3 routes, but Windows shell access and inline-command limits blocked that standalone script path.

Files modified:
`src/app.ts` - finished billing and entitlement module registration.
`test/helpers/app.ts` - finalized stub Stripe-provider injection for tests.
`test/helpers/db.ts` - extended table reset ordering for the new Phase 3 billing tables.
`test/integration/billing.stripe.test.ts` - added plans, subscription, checkout, portal, invoices, trial, and overlap coverage.
`test/integration/billing.webhooks.test.ts` - added signature verification, durable webhook, retry, and stale-lock recovery coverage.

Verification: `npx prisma validate`, `npx prisma generate`, `npx prisma migrate status`, `DATABASE_URL=postgresql://postgres@127.0.0.1:55432/typetalk_test?schema=public npx prisma migrate deploy`, `npx prisma db seed`, `npm run build`, `npx vitest run test/integration/billing.stripe.test.ts test/integration/billing.webhooks.test.ts`, `npm run test`, and `npm run billing:webhooks:retry` all succeeded. The standalone ad hoc smoke script did not run because of Windows shell limits, but the representative route coverage remained in the targeted integration suites and the retry CLI entrypoint run.

Status: DONE_WITH_DEVIATION

### Testing Results

```text
$ npx prisma validate
Prisma schema loaded from prisma\schema.prisma
The schema at prisma\schema.prisma is valid (ok)
Environment variables loaded from .env
```

```text
$ npx prisma generate
Prisma schema loaded from prisma\schema.prisma
Generated Prisma Client (v6.19.2) to .\node_modules\@prisma\client in 610ms
Environment variables loaded from .env
```

```text
$ npx prisma migrate status
Datasource "db": PostgreSQL database "typetalk_dev", schema "public" at "127.0.0.1:55432"
4 migrations found in prisma/migrations
Database schema is up to date!
```

```text
$ DATABASE_URL=postgresql://postgres@127.0.0.1:55432/typetalk_test?schema=public npx prisma migrate deploy
Datasource "db": PostgreSQL database "typetalk_test", schema "public" at "127.0.0.1:55432"
4 migrations found in prisma/migrations
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
$ npx vitest run test/integration/billing.stripe.test.ts
Test Files  1 passed (1)
Tests       9 passed (9)
Duration    35.27s
```

```text
$ npx vitest run test/integration/billing.webhooks.test.ts
Test Files  1 passed (1)
Tests       3 passed (3)
Duration    6.58s
```

```text
$ npm run test
Test Files  12 passed (12)
Tests       48 passed (48)
Duration    87.50s
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

### Success Criteria Checklist

- [x] Prisma schema and migration exist for all locked Phase 3 tables: `plans`, `provider_customers`, `subscriptions`, `entitlements`, and `webhook_events`.
- [x] `prisma/seed.ts` exists and safely seeds the canonical `free`, `pro_monthly`, and `pro_yearly` plans.
- [x] `GET /v1/billing/plans`, `GET /v1/billing/subscription`, `POST /v1/billing/stripe/checkout-session`, `POST /v1/billing/stripe/customer-portal`, `GET /v1/billing/invoices`, `POST /v1/webhooks/stripe`, and `GET /v1/entitlements/current` are implemented and verified.
- [x] `GET /v1/billing/plans` returns plan metadata from the database instead of scattered constants.
- [x] Stripe checkout creation is actor-scoped and idempotent: the same key plus same payload replays safely, and the same key plus different payload returns conflict.
- [x] Stripe checkout creation refuses to start when the current organization already has an active paid entitlement.
- [x] The 30-day Pro trial rule is implemented and persisted in Stripe-backed subscription state and entitlement recomputation.
- [x] The entitlement engine sets `billing_overlap=true` when more than one active paid Stripe subscription exists for the same organization and clears it again when overlap is resolved.
- [x] `GET /v1/billing/invoices` follows the shared `limit`, `cursor`, `items`, and `next_cursor` contract.
- [x] `POST /v1/webhooks/stripe` verifies the raw Stripe signature before processing, inserts the event row before downstream work, dedupes on `(provider, external_event_id)`, and preserves retryability.
- [x] The webhook-processing state machine uses real durable states: `received`, `processing`, `processed`, and `failed`.
- [x] Durable `webhook_events.payload_json` rows store only the minimal verified snapshot needed for retry processing and do not retain raw payment-instrument data.
- [x] A Railway-cron-compatible retry executor exists and successfully reprocesses `webhook_events` in `received`, `failed`, and stale `processing` recovery scenarios after forced failures.
- [x] `GET /v1/entitlements/current` returns the correct organization-scoped free, trial, or Stripe-paid result after billing changes.
- [x] The full automated suite, including existing Phase 1 and Phase 2 coverage plus the new Phase 3 billing coverage, passes against `typetalk_test`.

### Known Issues

- No open functional Phase 3 billing issues were identified after the Review Round 1 fixes and rerun verification.
- `npx prisma db seed` emitted the current Prisma warning that `package.json#prisma` is deprecated in favor of `prisma.config.ts`; the current seed path still works and did not block Phase 3 verification.
- A separate ad hoc standalone smoke script for representative Phase 3 routes was blocked by Windows shell access and inline-command limits. This did not block release verification because the affected route behavior was covered by `test/integration/billing.stripe.test.ts`, `test/integration/billing.webhooks.test.ts`, and the direct `npm run billing:webhooks:retry` run.
