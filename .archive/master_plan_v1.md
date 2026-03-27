# Master Implementation Plan

## Master Implementation Plan

### Project Overview

TypeTalk backend is a Node.js 22 + TypeScript + Fastify + Prisma + PostgreSQL control-plane backend for Android and Windows clients, with Railway as the production deployment target. Its v1 scope is locked by `final_plan.md`: email OTP auth, Google sign-in, session management, personal organizations, device registration, synced preferences, Stripe billing for web/Windows, Google Play verification for Android, unified entitlements, trusted usage tracking, weekly quota enforcement, and basic admin/security visibility.

The backend must remain privacy-conscious and must not store raw audio, raw transcript text, or raw app context by default. The implementation must follow the exact phase order already defined in the final plan, and public launch readiness depends on trusted quota enforcement, correct billing state, retry-safe webhook processing, and auth abuse protections.

Current starting state:
- No implementation phases are completed yet.
- The backend workspace currently contains planning/government files only.
- Phase 0 must start from an effectively empty backend implementation.

### Phase Breakdown

## Phase 0: Project Foundation

- Objective: establish the backend skeleton, local development baseline, configuration system, Prisma integration, health endpoint, and Railway-ready startup behavior so later phases can be built on a stable foundation.
- Key deliverables:
  - `package.json` with Node 22-compatible scripts and dependencies
  - `tsconfig.json`
  - `.env.example`
  - initial `src/` bootstrap files such as `src/app.ts` and `src/server.ts`
  - initial `src/config/` and shared app/plugin structure
  - initial `prisma/` setup with schema placeholder and Prisma client wiring
  - `GET /health` endpoint that confirms app and DB availability
  - local development scripts for install, generate, migrate, run, and test
  - Railway-ready runtime behavior: bind to `0.0.0.0:$PORT`, healthcheck path, migration path defined outside app startup
- Dependencies: none
- Estimated complexity: Medium
- Detailed Phase 0 step-by-step plan:
  1. Initialize the backend package for Node.js 22 and TypeScript, keeping the stack exactly aligned with the locked final plan: Fastify, Zod, Prisma, PostgreSQL, and Railway-ready startup behavior.
  2. Define the base project scripts in `package.json` for development, build, start, Prisma generation, Prisma migration, Prisma seed, and tests.
  3. Create `tsconfig.json` and any supporting TypeScript runtime settings needed for a clean local developer workflow.
  4. Create the target folder skeleton from the final plan: `prisma/`, `src/`, `src/config/`, `src/plugins/`, `src/modules/`, `src/lib/`, `src/jobs/`, and `test/`.
  5. Implement `src/app.ts` as the Fastify app factory and `src/server.ts` as the process entrypoint so app creation and server startup remain separable for testing.
  6. Implement configuration loading and validation with explicit environment parsing, including `PORT`, `DATABASE_URL`, JWT settings, OTP settings, body limits, allowed origins, billing keys, and Play/Stripe placeholders from the final plan.
  7. Add `.env.example` with every required variable listed in the final plan, while keeping real secrets out of source control.
  8. Initialize Prisma in `prisma/`, wire the Prisma client into the app, and confirm the project is prepared for local PostgreSQL development and Railway production using the same schema path.
  9. Add the initial `GET /health` route. It must verify both process health and database connectivity because the final plan requires the healthcheck to confirm app and DB availability.
  10. Set request-level basics that later phases rely on: request ID propagation, structured error shape foundations, explicit body size limits, and production-safe host/port startup defaults.
  11. Confirm the app supports the expected local command path from the final plan: `npm install`, `npx prisma generate`, `npx prisma migrate dev`, `npx prisma db seed`, `npm run dev`, and `npm run test`.
  12. Verify the skeleton end to end by running the server locally, checking `/health`, and confirming Prisma can connect to local PostgreSQL without running migrations automatically on app startup.
  13. Leave Phase 0 with a Railway-deployable skeleton only. Do not start auth, billing, or usage implementation until later phases.

## Phase 1: Identity and Users

- Objective: implement the complete v1 identity layer so users can sign in across Android and Windows with email OTP or Google, receive a personal organization, and maintain secure refresh sessions.
- Key deliverables:
  - Prisma schema and migration for `users`, `auth_identities`, `email_challenges`, `sessions`, `organizations`, `organization_members`, and `devices`
  - email OTP request, resend, and verify endpoints
  - Google sign-in endpoint
  - Google account linking flow that follows the no-silent-merge rules
  - refresh-token rotation and logout/session revocation behavior
  - `GET /v1/me`
  - OTP abuse protections and security event hooks for suspicious refresh reuse
- Dependencies: Phase 0 completed and verified
- Estimated complexity: High

## Phase 2: Preferences and Device Sync

- Objective: add user profile synchronization and device lifecycle support so one account can work consistently across multiple installations and retain preference data.
- Key deliverables:
  - Prisma schema and migration for `user_preferences`, `dictionary_entries`, `writing_profiles`, and `app_profiles`
  - device registration, heartbeat, list, and delete endpoints
  - preferences read/update endpoints
  - dictionary CRUD endpoints
  - writing profile CRUD endpoints
  - app profile read/update endpoints
  - limits and validation that respect per-user ownership and max active device rules
- Dependencies: Phase 1 completed and verified
- Estimated complexity: Medium

## Phase 3: Stripe Billing and Entitlements

- Objective: implement web/Windows billing through Stripe, store durable billing state, and expose a unified entitlement result for the application.
- Key deliverables:
  - Prisma schema and migration for `plans`, `provider_customers`, `subscriptions`, `entitlements`, `webhook_events`, and `idempotency_keys`
  - seed data for `free`, `pro_monthly`, and `pro_yearly`
  - Stripe checkout session endpoint
  - Stripe customer portal endpoint
  - current billing/subscription summary endpoint
  - raw-body Stripe webhook endpoint with signature verification
  - durable webhook receipt, deduplication, retry-safe state machine, and retry path
  - entitlement recomputation logic
  - trial handling and duplicate-paid-checkout prevention
  - `GET /v1/entitlements/current` for Stripe-backed access state
- Dependencies: Phase 1 completed and verified; Phase 2 is preferred because device and user context are already in place
- Estimated complexity: High

## Phase 4: Google Play Billing

- Objective: extend billing support to Android by securely verifying Google Play subscriptions, processing RTDN events, and merging provider state into the same entitlement model used by Stripe.
- Key deliverables:
  - Prisma schema and migration for `purchase_tokens`
  - Google Play verify-subscription endpoint
  - Google Play restore endpoint
  - RTDN webhook endpoint with trust verification
  - durable RTDN event insertion and retry-safe processing
  - purchase acknowledgment flow with retry behavior
  - provider-state sync and entitlement recomputation
  - duplicate subscription overlap detection when Stripe and Google Play are both active
- Dependencies: Phase 3 completed and verified
- Estimated complexity: High

## Phase 5: Usage and Quota

- Objective: implement the trusted usage-control layer that makes free-tier and paid-tier enforcement safe for public launch.
- Key deliverables:
  - Prisma schema and migration for `realtime_sessions`, `quota_windows`, `usage_events`, and `usage_rollups_weekly`
  - `POST /v1/realtime/session`
  - `POST /v1/usage/finalize`
  - telemetry-only `POST /v1/usage/events`
  - atomic quota enforcement transaction logic
  - UTC weekly quota window behavior
  - usage quota summary endpoints
  - trusted-result validation so client-declared billable counts are never authoritative
- Dependencies: Phase 3 and Phase 4 completed and verified because entitlements must be correct before quota enforcement is relied on
- Estimated complexity: High

## Phase 6: Security and Production Hardening

- Objective: add the final abuse controls, auditability, and operational hardening required before production launch.
- Key deliverables:
  - Prisma schema and migration for `ip_observations`, `security_events`, and `audit_logs`
  - auth rate limiting and abuse correlation
  - raw IP short-retention handling with hashed long-term correlation
  - admin read-only endpoints for users, subscriptions, and usage
  - stronger request logging and production error handling/tracking integration points
  - retention and privacy rule review across implemented modules
  - final release-readiness hardening around auth, billing, webhook retry, and quota enforcement
- Dependencies: Phases 0 through 5 completed and verified
- Estimated complexity: Medium

### Total Phases: 7
