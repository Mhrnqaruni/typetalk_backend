# Master Implementation Plan

## Master Implementation Plan

### Changes After Review Round 2

- Inspector comment: the plan still did not assign an actual webhook retry executor, even though retry-safe webhook processing is a launch blocker. Change made: Phase 3 now owns a concrete Railway cron job or equivalent retry runner for `webhook_events` in `received` and `failed` states, and Phase 4 explicitly extends that retry path to Google RTDN processing. Both phases now require failure-injection verification that a transiently failed event is retried successfully.
- Inspector comment: cursor pagination was still missing from the implementation plan even though the locked API conventions require it. Change made: Phase 0 now introduces the shared cursor pagination contract and helper, and the definitions of done for the list-endpoint phases now require `limit` and `cursor` inputs plus `items` and `next_cursor` outputs on representative collection routes.

### Changes After Review Round 1

- Inspector comment: several locked v1 routes were not assigned to any phase, including organization routes, user/session-management routes, `GET /v1/billing/plans`, and `GET /v1/billing/invoices`. Change made: every required route from the locked API list is now assigned to an owning phase, each relevant phase now lists those routes explicitly in its deliverables, and a scope matrix was added to map all required routes and tables to phases.
- Inspector comment: Phase 1 required suspicious refresh-token reuse to emit a persisted `security_event`, but the previous plan did not create the `security_events` table until Phase 6. Change made: minimum durable `security_events` schema support is now introduced in Phase 1 for auth-related events, and Phase 7 now expands security-event coverage while adding the remaining security/audit tables and hardening work.
- Inspector comment: Phase 0 did not preserve the locked plan's mandatory early Railway validation. Change made: Phase 0 now explicitly includes GitHub readiness, Railway project bootstrap, Railway Postgres wiring, deployment of the health skeleton, and Railway-backed `/health` verification as required deliverables and definition-of-done checks.
- Inspector comment: the previous plan created `idempotency_keys` but did not actually schedule idempotent behavior for device registration, Google verification/restore, or usage finalization. Change made: `idempotency_keys` has been moved forward into Phase 2 so device registration can use it on time, and explicit idempotent handling plus repeat-request verification is now required for device registration, Stripe checkout, Google verify/restore, and usage finalization.
- Inspector comment: Phase 0 omitted the locked `.env.test` and separate `typetalk_test` database requirements. Change made: Phase 0 now includes `.env.test`, isolated test database setup, test-runner configuration, and verification that tests run against `typetalk_test` rather than `typetalk_dev`.

### Project Overview

TypeTalk backend is a Node.js 22 + TypeScript + Fastify + Prisma + PostgreSQL control-plane backend for Android and Windows clients, with Railway as the production deployment target. Its locked v1 scope is: email OTP auth, Google sign-in, session management, personal organizations, device registration, synced preferences, Paddle billing for web/Windows, Google Play billing verification for Android, unified entitlements, trusted usage tracking, weekly quota enforcement, webhook durability, and basic admin/security visibility.

The backend must remain privacy-conscious and must not store raw audio, raw transcript text, raw prompt text, or raw app context by default. Public launch readiness depends on exact alignment with the locked final plan: correct auth behavior, correct provider-backed entitlements, trusted usage finalization, retry-safe webhook processing, explicit rate limiting, and Railway deployment validation.

Current implementation context:
- Completed implementation history already includes Phase 3 Stripe billing work and Phase 4 Google Play billing work in the backend codebase.
- Phase 5 usage/quota work must be finished and approved before any new billing-provider migration begins.
- The target launch direction is now Paddle for web/Windows and Google Play for Android; Stripe remains historical implementation context and possible transitional legacy data until the Paddle migration phase is complete.

### Phase Breakdown

Execution rule:
- Execute phases exactly in this order: Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, Phase 7.
- A later phase cannot start until the previous phase definition of done has been verified.

Operational execution requirements:
- Before resuming Phase 5 or starting any later phase, verify local repository state with `git rev-parse --is-inside-work-tree`, `git remote -v`, `gh auth status`, `git ls-remote https://github.com/Mhrnqaruni/typetalk_backend.git`, `railway whoami`, and `railway status`.
- The executor must treat GitHub backup checkpoints as mandatory: immediately after approved planning updates, before resuming Phase 5 execution, after each approved phase execution milestone, before schema migrations that materially change billing or production behavior, before Railway deployment changes, and after successful deploy-ready milestones.
- Railway deployment work must not proceed from an untracked local directory, and the correct Railway project/environment/service selection must be verified explicitly rather than assumed.

## Phase 0: Project Foundation

- Objective: establish the backend skeleton, configuration system, local PostgreSQL baseline, isolated test environment, Prisma integration, health endpoint, and early GitHub-to-Railway deployment path so later phases build on a verified foundation instead of assumptions.
- Key deliverables:
  - `package.json` with Node.js 22-compatible scripts and dependencies
  - `tsconfig.json`
  - `.env.example`
  - `.env.test`
  - initial `src/` bootstrap files such as `src/app.ts` and `src/server.ts`
  - initial `src/config/`, `src/plugins/`, `src/modules/`, `src/lib/`, `src/jobs/`, and `test/` structure
  - initial `prisma/` setup with `schema.prisma`, Prisma client wiring, and seed entrypoint placeholder
  - `GET /health` endpoint that confirms app and DB availability
  - local development support for `typetalk_dev`
  - isolated test-environment support for `typetalk_test`
  - shared cursor pagination contract and helper for collection endpoints: request `limit` and `cursor`, response `items` and `next_cursor`
  - GitHub-ready repository structure and Railway-ready runtime behavior: bind to `0.0.0.0:$PORT`, healthcheck path, and migration flow that runs before deploy rather than on app startup
  - initial Railway deployment of the health-check skeleton against Railway Postgres
- Dependencies: no previous project phase; requires local Node.js 22, local PostgreSQL, and access to GitHub/Railway for deployment validation
- Estimated complexity: Medium
- Detailed Phase 0 step-by-step plan:
  1. Initialize the backend package for Node.js 22 and TypeScript, keeping the stack exactly aligned with the locked plan: Fastify, Zod, Prisma, PostgreSQL, and Railway deployment.
  2. Define `package.json` scripts for local development, build, start, Prisma generate, Prisma migrate, Prisma seed, and tests.
  3. Create `tsconfig.json` and any TypeScript runtime settings required for a clean developer workflow.
  4. Create the target folder skeleton from the locked backend shape: `prisma/`, `src/`, `src/config/`, `src/plugins/`, `src/modules/`, `src/lib/`, `src/jobs/`, and `test/`.
  5. Implement `src/app.ts` as the Fastify app factory and `src/server.ts` as the process entrypoint so app construction and process startup remain separable for testing.
  6. Implement environment loading and validation, including the required variables from the locked plan for database access, JWT settings, OTP settings, allowed origins, body limits, Paddle, Google Play, email delivery, encryption keys, and any clearly-marked legacy Stripe values that must survive only until the later Paddle migration is complete.
  7. Add `.env.example` with every required variable from the locked plan.
  8. Add `.env.test` and configure the test runner so tests use `typetalk_test` and never point at `typetalk_dev`.
  9. Initialize Prisma, add the starting schema file and Prisma client wiring, and confirm the same Prisma setup can serve both local PostgreSQL and Railway PostgreSQL.
  10. Implement `GET /health` so it validates both process health and database connectivity.
  11. Add foundational app behavior required by later phases: request IDs, shared error-shape helpers, explicit body-size limits, strict CORS allowlist wiring, startup defaults for `0.0.0.0:$PORT`, and the shared cursor pagination contract for collection endpoints.
  12. Verify the expected local command path from the locked plan: `npm install`, `npx prisma generate`, `npx prisma migrate dev`, `npx prisma db seed`, `npm run dev`, and `npm run test`.
  13. Prepare GitHub repository readiness for backend deployment, including committed backend scaffolding, Prisma files, and environment templates.
  14. Bootstrap the Railway deployment path: create the Railway project, add the Railway Postgres service, wire `DATABASE_URL`, set required variables, and configure the deployment to use `prisma migrate deploy` before app start.
  15. Deploy the health-check skeleton to Railway and verify `/health` from the Railway deployment while connected to Railway Postgres.
- Definition of done:
  - `GET /health` works locally and confirms application plus database status.
  - The app starts locally with Node.js 22 and Prisma connects to local PostgreSQL.
  - `.env.test` exists and tests are configured to use `typetalk_test` instead of `typetalk_dev`.
  - `npm run test` executes against the isolated test database without mutating the development database.
  - No migrations run automatically on app startup.
  - The shared cursor pagination contract is defined before any list endpoints are implemented in later phases.
  - The backend skeleton is deployed to Railway and the Railway deployment returns a successful `/health` response while connected to Railway Postgres.

## Phase 1: Identity and Users

- Objective: implement the complete v1 identity layer so users can sign in across Android and Windows with email OTP or Google, receive a personal organization, manage sessions, and persist auth-related security events durably.
- Key deliverables:
  - Prisma schema and migration for `users`, `auth_identities`, `email_challenges`, `sessions`, `organizations`, `organization_members`, `devices`, and minimum Phase 1 `security_events` support required for auth abuse and refresh-token reuse logging
  - `POST /v1/auth/email/request-code`
  - `POST /v1/auth/email/resend-code`
  - `POST /v1/auth/email/verify-code`
  - `POST /v1/auth/google`
  - `POST /v1/auth/link/google`
  - `POST /v1/auth/refresh`
  - `POST /v1/auth/logout`
  - `GET /v1/me`
  - `PATCH /v1/me`
  - `DELETE /v1/me`
  - `GET /v1/sessions`
  - `DELETE /v1/sessions/:sessionId`
  - `GET /v1/organizations/current`
  - `GET /v1/organizations/members`
  - OTP brute-force protection, safe Google linking rules, refresh-token rotation, session-family revocation on suspicious token reuse, and persisted auth-related `security_events`
- Dependencies: Phase 0 completed and verified
- Estimated complexity: High
- Definition of done:
  - Every Phase 1 route listed above exists, validates input, and has either automated tests or explicit endpoint verification.
  - Collection endpoints in Phase 1, especially `GET /v1/sessions` and `GET /v1/organizations/members`, implement the shared cursor pagination contract with `limit`, `cursor`, `items`, and `next_cursor`.
  - New users receive a personal organization automatically.
  - Email OTP follows the locked rules: 6 digits, 10-minute expiry, max 5 attempts, one active challenge per email and purpose, resend supersedes prior active challenge, and rate limits are enforced.
  - Google sign-in and Google linking follow the locked no-silent-merge rules.
  - Refresh-token rotation works, reuse of a rotated token revokes the session family, and a durable `security_events` record is persisted for the suspicious reuse case.

## Phase 2: Preferences and Device Sync

- Objective: add account sync behavior for devices and preferences so a single user can work across multiple installations with consistent profile data, while introducing shared idempotency support needed by write-sensitive routes.
- Key deliverables:
  - Prisma schema and migration for `user_preferences`, `dictionary_entries`, `writing_profiles`, `app_profiles`, and `idempotency_keys`
  - `POST /v1/devices/register`
  - `PATCH /v1/devices/:deviceId/heartbeat`
  - `GET /v1/devices`
  - `DELETE /v1/devices/:deviceId`
  - `GET /v1/preferences`
  - `PUT /v1/preferences`
  - `GET /v1/dictionary`
  - `POST /v1/dictionary`
  - `PATCH /v1/dictionary/:entryId`
  - `DELETE /v1/dictionary/:entryId`
  - `GET /v1/writing-profiles`
  - `POST /v1/writing-profiles`
  - `PATCH /v1/writing-profiles/:profileId`
  - `GET /v1/app-profiles`
  - `PUT /v1/app-profiles/:appKey`
  - idempotent device registration using `idempotency_keys`
- Dependencies: Phase 1 completed and verified
- Estimated complexity: Medium
- Definition of done:
  - Every Phase 2 route listed above exists, validates input, and has either automated tests or explicit endpoint verification.
  - Collection endpoints in Phase 2, including `GET /v1/devices`, `GET /v1/dictionary`, `GET /v1/writing-profiles`, and collection-style `GET /v1/app-profiles`, implement the shared cursor pagination contract with `limit`, `cursor`, `items`, and `next_cursor`.
  - Two authenticated devices on the same account can read the same preferences, dictionary data, writing profiles, and app profiles.
  - Device registration is idempotent: repeating the same request with the same idempotency key does not create duplicate device state.
  - Device limits and ownership checks are enforced as required by the locked plan.

## Phase 3: Stripe Billing and Entitlements (Historical Completed Phase)

- Objective: document and preserve the already-completed Stripe-based web/Windows billing implementation history, which established the first durable billing state, unified entitlement result, and webhook retry path before Google Play integration.
- Historical note: this phase remains in the plan because the current backend already contains Stripe-backed routes, tables, and webhook handling. It must not be rewritten as Paddle. The target launch migration to Paddle is handled later in Phase 6.
- Key deliverables:
  - Prisma schema and migration for `plans`, `provider_customers`, `subscriptions`, `entitlements`, and `webhook_events`
  - seed data for `free`, `pro_monthly`, and `pro_yearly`
  - `GET /v1/billing/plans`
  - `GET /v1/billing/subscription`
  - `POST /v1/billing/stripe/checkout-session`
  - `POST /v1/billing/stripe/customer-portal`
  - `GET /v1/billing/invoices`
  - `POST /v1/webhooks/stripe`
  - `GET /v1/entitlements/current`
  - Stripe checkout idempotency using the `idempotency_keys` infrastructure introduced in Phase 2
  - Railway cron job or equivalent retry executor that scans `webhook_events` in `received` and `failed` states, safely locks work, retries processing, and updates retry metadata
  - raw-body Stripe signature verification, durable webhook receipt, insert-first processing, duplicate-event deduplication, retry-safe webhook state machine, trial handling, duplicate-paid-checkout blocking, and entitlement recomputation
- Dependencies: Phase 2 completed and verified; execution remains strictly sequential and Phase 3 must not begin before Phase 2 is done
- Estimated complexity: High
- Definition of done:
  - Every Phase 3 route listed above exists, validates input, and has either automated tests or explicit endpoint verification.
  - Collection endpoints in Phase 3, especially `GET /v1/billing/invoices`, implement the shared cursor pagination contract with `limit`, `cursor`, `items`, and `next_cursor`.
  - `GET /v1/billing/plans` returns plan data sourced from the database rather than scattered constants.
  - Repeating Stripe checkout creation with the same idempotency key does not create duplicate billing state.
  - Stripe webhook handling verifies the raw signature, inserts the event row before processing, preserves retryability, and recomputes entitlements correctly.
  - A forced Stripe webhook processing failure leaves the event row retryable, and the scheduled retry executor reprocesses it successfully.
  - `GET /v1/entitlements/current` returns the correct free, trial, or paid Stripe-derived state for the organization.

## Phase 4: Google Play Billing

- Objective: extend billing support to Android by securely verifying Google Play subscriptions, processing RTDN events, and merging provider state into the same entitlement model already exposed by the Stripe phase.
- Key deliverables:
  - Prisma schema and migration for `purchase_tokens`
  - `POST /v1/billing/google-play/verify-subscription`
  - `POST /v1/billing/google-play/restore`
  - `POST /v1/webhooks/google-play/rtdn`
  - extension of `GET /v1/billing/subscription`, `GET /v1/billing/invoices`, and `GET /v1/entitlements/current` so responses remain unified when Google Play is the active provider
  - idempotent Google verification and restore handling using `idempotency_keys`
  - extension of the Phase 3 retry executor so Google RTDN rows in `received` and `failed` states are retried through the same durable event-processing path
  - secure purchase verification, durable RTDN receipt, linked purchase-token support, acknowledgment of initial purchases after verification, provider-state sync, duplicate-subscription overlap detection, and entitlement recomputation
- Dependencies: Phase 3 completed and verified
- Estimated complexity: High
- Definition of done:
  - Every Phase 4 route listed above exists, validates input, and has either automated tests or explicit endpoint verification.
  - Repeating Google verify/restore requests with the same idempotency key does not create duplicate state changes.
  - RTDN events are verified, stored durably, acknowledged quickly, and remain retryable if downstream processing fails.
  - A forced RTDN processing failure leaves the event row retryable, and the scheduled retry executor reprocesses it successfully.
  - Google Play subscriptions update the same entitlement route used by Stripe and correctly surface overlap with existing Stripe subscriptions.

## Phase 5: Usage and Quota

- Objective: implement the trusted usage-control layer that makes free-tier and paid-tier enforcement safe for public launch.
- Key deliverables:
  - Prisma schema and migration for `realtime_sessions`, `quota_windows`, `usage_events`, and `usage_rollups_weekly`
  - `POST /v1/realtime/session`
  - `POST /v1/usage/finalize`
  - `POST /v1/usage/events`
  - `GET /v1/usage/summary`
  - `GET /v1/usage/quota`
  - idempotent usage finalization using `idempotency_keys`
  - atomic quota enforcement transaction logic
  - UTC weekly window handling
  - trusted-result validation so client-declared billable counts are never authoritative
- Dependencies: Phase 4 completed and verified; entitlement behavior must already be correct before usage enforcement is relied on publicly
- Estimated complexity: High
- Definition of done:
  - Every Phase 5 route listed above exists, validates input, and has either automated tests or explicit endpoint verification.
  - Free-tier quota enforcement is atomic and race-safe inside one database transaction.
  - Repeating a finalize request with the same idempotency key does not double-spend quota or create duplicate billable usage rows.
  - `POST /v1/usage/finalize` rejects untrusted client-declared billable truth and only spends quota when a trusted server-owned session result exists.
  - `POST /v1/usage/events` remains telemetry-only and cannot affect billable quota.

## Phase 6: Paddle Billing Migration for Web/Windows

- Objective: migrate the target launch billing provider for web/Windows from historical Stripe implementation to Paddle while preserving Google Play for Android, keeping unified entitlements correct, and making the Railway deployment and environment model match the new provider direction.
- Key deliverables:
  - provider-abstraction updates so web/Windows billing flows are Paddle-backed while Android remains Google Play-backed
  - documented legacy-Stripe transition policy that clearly states whether existing Stripe routes/data remain read-only transitional support, are migrated, or are retired after Paddle parity is proven
  - schema and migration updates across `plans`, `provider_customers`, `subscriptions`, `entitlements`, and `webhook_events`, plus any minimal transitional billing metadata needed to preserve historical Stripe records safely during the migration
  - plan-catalog and seed updates so launch pricing/product identifiers rely on Paddle product or price identifiers instead of Stripe price IDs
  - `POST /v1/billing/paddle/checkout`
  - `POST /v1/billing/paddle/customer-portal`
  - `POST /v1/webhooks/paddle`
  - migration of web/Windows billing behavior inside `GET /v1/billing/subscription`, `GET /v1/billing/invoices`, and `GET /v1/entitlements/current` so Paddle becomes the target provider-backed source of truth
  - Paddle webhook verification, durable receipt, insert-first processing, duplicate-event deduplication, retry-safe state machine handling, retry-executor integration, entitlement recomputation, and failure-injection verification
  - replacement of Stripe-centric deployment/env expectations with Paddle secrets and identifiers, with explicit treatment of which old Stripe variables remain only as legacy transitional configuration
- Dependencies: Phase 5 completed and verified first; GitHub backup checkpoint created before migration work starts; repo/GitHub/Railway operational checks pass; Google Play entitlement behavior must still be green before and after the migration
- Estimated complexity: High
- Definition of done:
  - Every Paddle route listed above exists, validates input, and has automated tests or explicit endpoint verification.
  - Paddle webhook handling verifies authenticity, stores events durably before processing, preserves retryability, and recomputes entitlements correctly.
  - The shared retry executor safely processes Paddle-backed `webhook_events` and does not regress Google RTDN retry behavior.
  - The plan catalog, provider abstractions, and env configuration all describe Paddle as the active web/Windows provider instead of Stripe.
  - Legacy Stripe handling is explicitly documented and implemented so the codebase distinguishes historical Stripe state from the target launch provider.
  - Railway verification is completed after the Paddle phase, including correct project/environment/service selection and deploy-ready validation from the tracked local repository.

## Phase 7: Security and Production Hardening

- Objective: add the remaining abuse controls, auditability, admin visibility, and operational hardening required before production launch.
- Key deliverables:
  - Prisma schema and migration for `ip_observations` and `audit_logs`
  - expansion of the `security_events` model introduced in Phase 1 so rate limits, suspicious activity, and security-relevant workflows are durably recorded across the application
  - `GET /v1/admin/users/:userId`
  - `GET /v1/admin/subscriptions`
  - `GET /v1/admin/usage`
  - auth rate limiting
  - short-retention raw-IP handling with long-term HMAC-based correlation
  - stronger request logging, error-tracking integration points, and retention/privacy review across implemented modules
- Dependencies: Phases 0 through 6 completed and verified
- Estimated complexity: Medium
- Definition of done:
  - Every Phase 7 route listed above exists, validates input, and has either automated tests or explicit endpoint verification.
  - Collection endpoints in Phase 7, especially `GET /v1/admin/subscriptions` and collection-style `GET /v1/admin/usage`, implement the shared cursor pagination contract with `limit`, `cursor`, `items`, and `next_cursor`.
  - Auth rate limits are active and produce durable security logging.
  - Raw IP retention is time-bounded and long-term correlation uses hashed values only.
  - Admin read-only endpoints can inspect users, subscriptions, and usage without introducing support impersonation or other deferred scope.
  - The full implemented system satisfies the locked public-launch blockers: trusted quota enforcement, retry-safe webhook handling, OTP brute-force protection, Paddle billing correctness, Google Play verification plus acknowledgment, and unified entitlements.

### Scope Matrix

Route ownership:
- Phase 0: `GET /health`
- Phase 1: `POST /v1/auth/email/request-code`, `POST /v1/auth/email/resend-code`, `POST /v1/auth/email/verify-code`, `POST /v1/auth/google`, `POST /v1/auth/link/google`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `GET /v1/me`, `PATCH /v1/me`, `DELETE /v1/me`, `GET /v1/sessions`, `DELETE /v1/sessions/:sessionId`, `GET /v1/organizations/current`, `GET /v1/organizations/members`
- Phase 2: `POST /v1/devices/register`, `PATCH /v1/devices/:deviceId/heartbeat`, `GET /v1/devices`, `DELETE /v1/devices/:deviceId`, `GET /v1/preferences`, `PUT /v1/preferences`, `GET /v1/dictionary`, `POST /v1/dictionary`, `PATCH /v1/dictionary/:entryId`, `DELETE /v1/dictionary/:entryId`, `GET /v1/writing-profiles`, `POST /v1/writing-profiles`, `PATCH /v1/writing-profiles/:profileId`, `GET /v1/app-profiles`, `PUT /v1/app-profiles/:appKey`
- Phase 3: `GET /v1/billing/plans`, `GET /v1/billing/subscription`, `POST /v1/billing/stripe/checkout-session`, `POST /v1/billing/stripe/customer-portal`, `GET /v1/billing/invoices`, `POST /v1/webhooks/stripe`, `GET /v1/entitlements/current`
- Phase 4: `POST /v1/billing/google-play/verify-subscription`, `POST /v1/billing/google-play/restore`, `POST /v1/webhooks/google-play/rtdn`, plus Google Play support added into `GET /v1/billing/subscription`, `GET /v1/billing/invoices`, and `GET /v1/entitlements/current`
- Phase 5: `POST /v1/realtime/session`, `POST /v1/usage/finalize`, `POST /v1/usage/events`, `GET /v1/usage/summary`, `GET /v1/usage/quota`
- Phase 6: `POST /v1/billing/paddle/checkout`, `POST /v1/billing/paddle/customer-portal`, `POST /v1/webhooks/paddle`, plus Paddle-backed migration of web/Windows behavior inside `GET /v1/billing/subscription`, `GET /v1/billing/invoices`, and `GET /v1/entitlements/current`, with explicit legacy handling for existing Stripe routes
- Phase 7: `GET /v1/admin/users/:userId`, `GET /v1/admin/subscriptions`, `GET /v1/admin/usage`

Table ownership:
- Phase 1: `users`, `auth_identities`, `email_challenges`, `sessions`, `organizations`, `organization_members`, `devices`, minimum `security_events`
- Phase 2: `user_preferences`, `dictionary_entries`, `writing_profiles`, `app_profiles`, `idempotency_keys`
- Phase 3: `plans`, `provider_customers`, `subscriptions`, `entitlements`, `webhook_events`
- Phase 4: `purchase_tokens`
- Phase 5: `realtime_sessions`, `quota_windows`, `usage_events`, `usage_rollups_weekly`
- Phase 6: Paddle migration updates to `plans`, `provider_customers`, `subscriptions`, `entitlements`, and `webhook_events`, plus any minimal transitional billing metadata required to preserve historical Stripe records safely
- Phase 7: `ip_observations`, `audit_logs`, and expanded application-wide `security_events` coverage

Cross-cutting infrastructure ownership:
- Phase 0: shared cursor pagination contract and helper
- Phase 3: Railway cron job or equivalent retry executor for Stripe-backed `webhook_events`
- Phase 4: retry executor extended to Google Play RTDN-backed `webhook_events`
- Phase 6: retry executor extended again to Paddle-backed `webhook_events`, while keeping any remaining legacy Stripe retry path safe until migration cleanup is complete

### Total Phases: 8
