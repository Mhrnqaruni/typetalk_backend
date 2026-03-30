## Phase 7 — Implementation Plan

### Changes After Review Round 1

- Inspector comment: the durable auth-throttling step was too vague and could weaken the existing OTP abuse protections by collapsing distinct controls into one mechanism.
  - What I changed: I made the plan explicitly preserve all three existing auth-abuse layers after the refactor: the current DB-backed per-email-plus-purpose OTP issuance limit in `email_challenges`, the current OTP attempt lockout semantics on each challenge row, and a new separate durable per-IP limiter keyed by `scope`, `ip_hash`, and `window_start` through a dedicated rate-limit bucket store rather than through `security_events`.
  - Why: The final Phase 7 implementation must strengthen the current protections, not accidentally replace two durable controls with one weaker or noisier one.

- Inspector comment: the raw-IP expiry step allowed cleanup to be manual or deferred, which would not guarantee short-lived raw IP in production.
  - What I changed: I rewrote the retention step so Phase 7 must ship a concrete production execution path, specifically a Railway-cron-compatible or equivalently scheduled runner owned by this phase, and I added verification that the trigger path exists and runs without manual intervention.
  - Why: Raw IP must be short-lived before launch, so the cleanup mechanism cannot be left as an operational follow-up.

- Inspector comment: the admin-endpoint plan warned about privacy exposure but did not lock explicit response allowlists or forbidden fields.
  - What I changed: I updated the admin step, testing strategy, and success criteria to require curated `select`/serializer logic and explicit exclusion of sensitive internals such as OTP hashes, refresh-token hashes, raw IP ciphertext, and raw webhook payload data.
  - Why: Read-only admin visibility still needs strict response shaping so Phase 7 does not create new data-exposure risks.

### Objective

Phase 7 hardens the already-built TypeTalk backend for production by adding the remaining abuse controls, short-retention IP handling, auditability, admin read-only visibility, and stronger observability required by the locked final plan. This phase should not change the product surface from Phases 0-6; it should make the existing auth, billing, entitlement, and usage flows safer to operate and support.

### Prerequisites

- Phase 6 is approved and the current backend is green on its existing verification matrix (`npm run build`, focused billing regressions, and `npm run test`).
- The current Paddle, Google Play, auth, entitlement, and usage flows are working in local and test databases.
- The executor has re-read `final_plan.md`, `master_plan.md`, `project_status.md`, and `phase_6/exec_report.md` so the Phase 7 work builds on the actual Phase 6 baseline.
- Local `typetalk_dev` and `typetalk_test` databases are available and can accept a new Prisma migration.
- A GitHub backup checkpoint exists after approved Phase 6 work, and repo/GitHub/Railway readiness can be rechecked before execution.
- Current security-related baseline is understood:
  - `security_events` already exists from Phase 1.
  - `AuthRateLimiter` is currently process-local/in-memory in `src/modules/auth/rate-limiter.ts`.
  - OTP issuance already has a durable DB-backed per-email-plus-purpose throttle through `AuthService.issueEmailChallenge()` and `countRecentChallenges(...)`.
  - OTP verification already has durable attempt-lockout semantics on `email_challenges.attempt_count` and `max_attempts`.
  - `src/modules/security/` currently only records events and does not yet manage `ip_observations` or `audit_logs`.
  - There is no `src/modules/admin/` module yet.

### Steps

1. Define the Phase 7 access-control, retention, and observability model before changing schema or routes.
   - What to do: Lock the implementation choices that are still implicit in the current codebase. Phase 7 should use authenticated, env-allowlisted admins for read-only admin endpoints instead of inventing new admin-role tables; raw IP should remain short-lived encrypted data while `ip_hash` remains the long-term correlation key; and error tracking should be added as an optional integration point rather than a vendor-specific rewrite.
   - Which files are affected: `src/config/env.ts`, `.env.example`, `.env.test`, `src/app.ts`, `src/plugins/auth.ts`, new `src/plugins/admin.ts` or equivalent access-control helper, and later `src/modules/admin/*`.
   - Expected outcome / how to verify: The execution phase has a fixed target for admin access, security retention, and error capture; new env values parse successfully in local and test environments; there is no ambiguity about whether Phase 7 introduces new admin roles or support impersonation.
   - Potential risks: Choosing a weak admin gate can expose sensitive operational data; choosing an overbuilt admin model adds unsupported scope. Misconfigured env defaults can lock out legitimate admin access.

2. Add the missing Phase 7 database primitives and migration.
   - What to do: Extend `prisma/schema.prisma` with the locked `ip_observations` and `audit_logs` tables, wire relations back to `users`, `organizations`, and any relevant actor/target references, and expand `security_events` only where Phase 7 needs additional indexes or queryability. Add a small dedicated durable rate-limit bucket store, for example `auth_rate_limit_buckets`, keyed by `scope`, `ip_hash`, and `window_start`, so the new per-IP limiter has its own counter ledger instead of overloading `security_events`. Create a Prisma migration for the new tables and indexes.
   - Which files are affected: `prisma/schema.prisma`, a new migration under `prisma/migrations/*`, and `test/helpers/db.ts` if table reset ordering must include the new tables.
   - Expected outcome / how to verify: `npx prisma validate`, `npx prisma generate`, local `npx prisma migrate dev`, and test DB `npx prisma migrate deploy` all pass; the database now supports IP observations, audit logs, and a dedicated durable per-IP limiter backing store without breaking existing Phase 0-6 schema or tests.
   - Potential risks: Incorrect foreign keys or indexes can make later admin/security queries slow or brittle. The supporting bucket table is implementation-only infrastructure, so it must stay narrow and not drift into a generic event log.

3. Extend the security layer to support hashed IP correlation, encrypted short-lived raw IP storage, and reusable security-data writes.
   - What to do: Add the security primitives needed to record `ip_observations`: stable `ip_hash`, `hash_key_version`, encrypted `raw_ip_ciphertext`, `raw_ip_expires_at`, and any available country/region/ASN metadata. Reuse the existing `IP_HASH_KEY_V1` semantics and add the minimal crypto helpers needed for reversible short-lived IP storage.
   - Which files are affected: `src/lib/crypto.ts`, `src/modules/security/repository.ts`, `src/modules/security/service.ts`, and any small supporting helper added under `src/modules/security/`.
   - Expected outcome / how to verify: A single service call can persist the durable hashed IP view plus the expiring raw-IP view; focused tests can prove the hash is stable while the encrypted raw IP is stored with an expiry timestamp.
   - Potential risks: Using the wrong encryption approach or key material can create fragile behavior or violate the locked privacy posture. Storing raw IP beyond the minimum needed window would be a plan violation.

4. Replace the current process-local auth limiter with durable, security-logged rate limiting.
   - What to do: Upgrade `src/modules/auth/rate-limiter.ts` so auth request-code and verify-code throttling is durable across process restarts and suitable for Railway without Redis. The final design must preserve three separate protections instead of collapsing them:
     1. keep the current DB-backed per-email-plus-purpose OTP issuance throttle in `AuthService.issueEmailChallenge()` and `countRecentChallenges(...)`,
     2. keep the current OTP attempt lockout semantics on each `email_challenges` row,
     3. add a new durable per-IP limiter keyed by auth scope plus hashed IP plus `window_start`, with separate scopes for `auth_email_request` and `auth_email_verify`.
     `security_events` must record limit hits and lockouts, but must not be the primary counter store for the durable limiter.
   - Which files are affected: `src/modules/auth/rate-limiter.ts`, `src/modules/auth/routes.ts`, `src/modules/auth/service.ts`, `src/modules/security/repository.ts`, `src/modules/security/service.ts`, `src/app.ts`, `test/helpers/app.ts`, `test/integration/auth.email.test.ts`, and any repository/service code that persists the new rate-limit buckets.
   - Expected outcome / how to verify: Per-email issuance throttling still works, OTP attempt lockout behavior on challenge rows is unchanged, and per-IP request/verify throttling now survives app recreation and process restarts. The database shows durable counter rows plus the corresponding `security_events` and `ip_observations` when limits are hit.
   - Potential risks: A database-backed limiter can add query cost if indexes are wrong or the design is too chatty. Merging the three protections incorrectly would weaken the current auth-abuse behavior instead of hardening it.

5. Expand security-event coverage for concrete abuse and security-sensitive workflows.
   - What to do: Build on the existing `refresh_token_reuse_detected` event and add durable `security_events` for rate-limit hits, OTP lockouts or attempt exhaustion, admin access denials, and other small, explicit Phase 7 security flows already present in the application. Keep the event taxonomy operationally useful and narrow.
   - Which files are affected: `src/modules/security/service.ts`, `src/modules/security/repository.ts`, `src/modules/auth/service.ts`, `src/modules/auth/routes.ts`, and the new admin module plus related integration tests.
   - Expected outcome / how to verify: The most important abuse and security transitions generate durable rows with correct severity and linked user/org/device/IP context when available. Focused integration tests confirm those rows appear only for real security-relevant transitions.
   - Potential risks: Over-logging turns `security_events` into noisy debug data; under-logging leaves public-launch blockers unresolved. Inconsistent event names reduce support value.

6. Implement short-retention raw-IP expiry and operational cleanup.
   - What to do: Add the retention behavior for `ip_observations` so expired `raw_ip_ciphertext` is cleared while the durable hashed correlation fields remain. Phase 7 must also own a concrete production execution path for this cleanup, such as a Railway-cron-compatible runner or another explicitly scheduled job that is wired before the phase can be called done; manual-only cleanup is not acceptable.
   - Which files are affected: new job such as `src/jobs/security-retention.ts` or `src/jobs/ip-observations-retention.ts`, `package.json`, `src/modules/security/repository.ts`, `src/modules/security/service.ts`, and any Railway-cron-compatible command wiring or documented deployment/runtime configuration required to run the job automatically in production.
   - Expected outcome / how to verify: Given seeded expired observations, the cleanup job removes raw-IP ciphertext and expiry data while keeping the `ip_hash` and other durable metadata needed for abuse correlation. Execution verification must prove both that the cleanup code works and that the production trigger path exists and can run without manual intervention.
   - Potential risks: An aggressive cleanup can delete data still needed for short-term incident response; a weak or unwired cleanup path leaves raw IP in the system too long even if the code exists.

7. Create the read-only admin module and route surface with explicit admin gating.
   - What to do: Add a dedicated admin module for `GET /v1/admin/users/:userId`, `GET /v1/admin/subscriptions`, and `GET /v1/admin/usage`. Keep the endpoints strictly read-only, enforce explicit admin access, use the shared cursor pagination contract for the collection routes, and lock the response shape to curated `select`/serializer logic rather than raw Prisma records. The admin responses must never expose OTP hashes, refresh-token hashes, raw IP ciphertext, raw webhook payloads, or other similar internal-only fields even to allowlisted admins.
   - Which files are affected: new `src/modules/admin/repository.ts`, `src/modules/admin/service.ts`, `src/modules/admin/schemas.ts`, `src/modules/admin/routes.ts`, new `src/plugins/admin.ts` or equivalent guard, `src/app.ts`, and new integration coverage such as `test/integration/admin.test.ts`.
   - Expected outcome / how to verify: Authenticated allowlisted admins can inspect curated user, subscription, and usage views; non-admin users are denied cleanly; `GET /v1/admin/subscriptions` and `GET /v1/admin/usage` return `items` and `next_cursor`; response-contract tests prove sensitive internal fields are absent.
   - Potential risks: Returning too much data creates privacy exposure; returning too little makes the endpoints unusable for support and operations. Poor query design can introduce N+1 problems or accidentally bypass serializer-based redaction.

8. Add audit-log writes for successful admin reads and other admin-sensitive actions introduced in Phase 7.
   - What to do: Implement the `audit_logs` write path and make admin endpoints record who accessed what, through which request ID, and with concise metadata. Keep audit writes targeted to admin-sensitive reads/actions; do not turn them into generic request logs.
   - Which files are affected: `src/modules/security/repository.ts` and `service.ts` if audit stays in the security module, or a small dedicated audit helper under `src/modules/security/` or `src/modules/admin/`; `src/app.ts`; admin route/service files; and new admin integration tests.
   - Expected outcome / how to verify: Successful admin requests create `audit_logs` rows with actor, target, action, request ID, and compact metadata; tests can confirm those rows exist and do not include raw secrets or unrelated payloads.
   - Potential risks: Logging excessive metadata can create new privacy exposure; missing request IDs or target references reduces the operational usefulness of the audit trail.

9. Strengthen request logging and add an optional error-tracking integration point.
   - What to do: Improve the Fastify logging setup so logs remain structured and useful while redacting authorization headers, refresh tokens, webhook secrets, raw-IP ciphertext, and similar sensitive fields. Add a small error-tracking abstraction or capture hook for unexpected 5xx errors in `app.setErrorHandler`, but keep it optional and provider-agnostic.
   - Which files are affected: `src/app.ts`, `src/config/env.ts`, `.env.example`, `.env.test`, and a small new helper such as `src/lib/observability.ts` or `src/lib/error-tracking.ts`; extend `test/integration/error-handling.test.ts` if needed.
   - Expected outcome / how to verify: 5xx errors still generate internal logs and optional external capture, client responses remain sanitized, and tests confirm that sensitive details are not leaked in API responses or structured logs.
   - Potential risks: Over-redaction can hide useful diagnostics; under-redaction can leak secrets into logs or error-tracking systems. Adding a vendor-specific SDK directly here would over-scope the phase.

10. Run the full Phase 7 hardening verification matrix and launch-readiness review.
   - What to do: After all changes land, run the complete schema/build/test matrix plus focused Phase 7 checks for durable auth throttling, security-event writes, IP observation cleanup, admin access control, audit-log creation, and non-regression across billing, entitlements, and usage. Re-run repo/GitHub/Railway readiness checks because Phase 7 is the final production-hardening phase before launch.
   - Which files are affected: no new product files if implementation is complete; execution will record results in `phase_7/exec_report.md`. Verification covers `prisma/schema.prisma`, `src/modules/auth/*`, `src/modules/security/*`, `src/modules/admin/*`, `src/jobs/*`, `src/app.ts`, and the full `test/` suite.
   - Expected outcome / how to verify: The full matrix is green, new Phase 7 tests pass, and the codebase still satisfies the Phase 0-6 behavior while closing the remaining public-launch blockers around auth abuse protection, admin visibility, and security retention.
   - Potential risks: Security hardening often introduces subtle auth regressions, especially around request metadata and rate-limit behavior. Admin/audit additions can also break test isolation if teardown is incomplete.

### Testing Strategy

- Run Prisma verification first:
  - `npx prisma validate`
  - `npx prisma generate`
  - local migration apply with `npx prisma migrate dev`
  - test DB migration apply with `npx prisma migrate deploy`
- Add focused integration coverage for durable auth throttling:
  - per-email-plus-purpose OTP issuance throttling from `email_challenges` still works
  - request-code per-IP limit hit
  - verify-code per-IP limit hit
  - OTP lockout or exhausted attempts on challenge rows remains unchanged
  - proof that the final per-IP limiter is not only in memory
- Add focused security-data tests:
  - `security_events` rows created for refresh reuse, auth rate-limit hits, OTP lockouts, and admin access denials
  - `ip_observations` writes include `ip_hash` plus short-lived encrypted raw IP
  - retention runner clears expired raw-IP ciphertext but leaves hashed correlation data
  - the chosen production trigger path for retention cleanup exists and can be invoked without manual ad hoc steps
- Add dedicated admin integration tests:
  - allowlisted admin can read `GET /v1/admin/users/:userId`
  - allowlisted admin can page through `GET /v1/admin/subscriptions`
  - allowlisted admin can page through `GET /v1/admin/usage`
  - non-admin access is denied
  - successful admin reads create `audit_logs`
  - response contracts prove OTP hashes, refresh-token hashes, raw IP ciphertext, and raw webhook payload data are absent
- Extend error-handling coverage so Phase 7 logging/error-capture changes do not leak internal details or secrets.
- Re-run the full regression suite with `npm run test` after focused Phase 7 tests pass.
- Re-run `npm run build` after all code and tests pass.
- Re-run operational readiness checks before closeout:
  - `git rev-parse --is-inside-work-tree`
  - `git remote -v`
  - `gh auth status`
  - `git ls-remote https://github.com/Mhrnqaruni/typetalk_backend.git`
  - `railway whoami`
  - `railway status`

### Success Criteria

- `ip_observations` and `audit_logs` exist in Prisma and in the applied database schema, with indexes that support auth abuse and admin inspection use cases.
- Auth request-code and verify-code throttling is durable, returns correct `429` responses, writes database-backed security data, and preserves the existing durable per-email issuance throttle plus OTP attempt-lockout semantics.
- Security logging covers at least refresh-token reuse, auth rate-limit hits, OTP lockouts or exhausted attempts, and admin access denials.
- Raw IP retention is time-bounded: hashed IP correlation remains durable while encrypted raw IP data is cleared after expiry through a concrete Phase 7 production trigger path rather than by manual cleanup.
- `GET /v1/admin/users/:userId`, `GET /v1/admin/subscriptions`, and `GET /v1/admin/usage` exist, are read-only, are protected by explicit admin access control, and create audit logs for successful admin reads.
- Admin collection endpoints use the shared cursor pagination contract with `items` and `next_cursor`.
- Admin response payloads use curated serializers/selects and do not expose OTP hashes, refresh-token hashes, raw IP ciphertext, raw webhook payloads, or similar sensitive internals.
- Request logging and 5xx error capture are stronger than the current baseline while still redacting sensitive data.
- `npm run build` and the full `npm run test` suite pass after the hardening work.
- Repo/GitHub/Railway readiness checks are green at the end of the phase.
- The backend now satisfies the locked Phase 7 definition of done: auth abuse is rate-limited, security logs exist, and admin can inspect users, subscriptions, and usage without adding deferred-scope impersonation or support-session features.
