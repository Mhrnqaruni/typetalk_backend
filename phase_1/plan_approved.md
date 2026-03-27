## Phase 1 — Implementation Plan

### Changes After Review Round 2

- Inspector comment: session lifecycle handling was still too implicit for a security-sensitive phase. What changed: Step 2 now explicitly requires the locked session fields `expires_at`, `user_agent`, `last_ip_hash`, `last_ip_country_code`, and `last_used_at`; Step 8 now requires those fields to be populated on session creation; Step 11 now requires refresh to fail on expired sessions and to update session metadata on every successful refresh; Step 13 now requires `GET /v1/sessions` to expose safe session-management metadata while keeping sensitive values internal; the testing strategy and success criteria now include expiry enforcement and session-metadata verification. Why: Phase 1 cannot claim correct session management unless session lifetime, metadata capture, refresh updates, and safe session visibility are all defined precisely.

### Changes After Review Round 1

- Inspector comment: refresh-token rotation and replay detection were still too abstract. What changed: Step 2 now requires a stable session-family anchor in the schema via the session row plus a `reauthenticated_at` field, Step 11 now defines the refresh token format as `session_id + opaque secret`, and Step 12 now defines the exact replay-detection path: look up by session id, compare the submitted secret hash against the current stored hash, rotate in place on success, treat a mismatch on an existing active session as suspicious reuse, and revoke the anchored session family. Why: without a concrete family model, it is too easy to implement rotation without reliable replay detection.
- Inspector comment: recent re-auth for `POST /v1/auth/link/google` had no source of truth. What changed: Step 2 adds `reauthenticated_at` to the session design, Step 10 defines recent re-auth as a successful OTP verify or Google sign-in recorded on the session within the last 10 minutes, and the testing section now requires fresh-session and stale-session linking checks. Why: linking a new identity is security-sensitive and needs one explicit, measurable rule rather than an implied concept.
- Inspector comment: `DELETE /v1/me` was too loose even though soft delete is a locked Phase 1 behavior. What changed: Step 13 now requires `deleted_at`-based soft deletion, revocation of all active sessions for that user, exclusion from active-user lookups, and verification that deleted users cannot refresh or access authenticated routes with old sessions. Why: if account deletion behavior is underspecified, the executor could implement a partial delete that leaves active access alive.

### Objective

Phase 1 establishes the full identity and user-management layer for TypeTalk. At the end of this phase, a user must be able to sign in with email OTP or Google, receive a personal organization automatically, manage sessions safely, and trigger durable auth-related security events for suspicious refresh-token reuse.

### Prerequisites

- Phase 0 must be completed and re-verified before implementation starts. The current project status still shows no completed phases, so this is a hard gate, not a formality.
- The Phase 0 scaffold must already exist and be working: `package.json`, `tsconfig.json`, `.env.example`, `.env.local`, `.env.test`, `prisma/schema.prisma`, `src/app.ts`, `src/server.ts`, config loading, Prisma wiring, and `GET /health`.
- Local PostgreSQL databases `typetalk_dev` and `typetalk_test` must exist and be reachable.
- Test infrastructure must already use `typetalk_test`, not `typetalk_dev`.
- Shared API conventions from Phase 0 must already exist: request IDs, standard error shape, explicit body limits, strict CORS wiring, and cursor pagination helpers.
- Required secrets/config placeholders must be available in local env files for JWT signing, Google token verification, email sending, and IP hashing.
- The file names below assume the folder structure from the master plan. If the Phase 0 scaffold uses slightly different file names, keep the same responsibilities and module boundaries.

### Steps

1. Confirm Phase 0 readiness before touching Phase 1 code.
   - What to do: run a readiness audit to confirm the backend scaffold, Prisma connectivity, env handling, test DB isolation, and health route are already working. Do not begin schema or auth work until the foundation is verified.
   - Which files are affected: no code changes expected; review `package.json`, `tsconfig.json`, `.env.example`, `.env.test`, `prisma/schema.prisma`, `src/app.ts`, `src/server.ts`, `src/config/*`, and existing test setup files.
   - Expected outcome / how to verify: `npm run dev`, `npm run test`, `npx prisma generate`, and the local `/health` check all work against the Phase 0 scaffold; any missing prerequisite is documented before continuing.
   - Potential risks: starting Phase 1 on an incomplete Phase 0 scaffold will create false auth bugs, broken migrations, or tests hitting the wrong database.

2. Define the Phase 1 data model in Prisma.
   - What to do: add Phase 1 tables, enums, constraints, and indexes to `prisma/schema.prisma` for `users`, `auth_identities`, `email_challenges`, `sessions`, `organizations`, `organization_members`, `devices`, and minimum `security_events` support required for auth flows. The `sessions` model must be the stable family anchor for refresh rotation, must keep the current `refresh_token_hash`, must add `reauthenticated_at` so recent re-auth can be enforced explicitly, and must explicitly include and use the locked lifecycle/metadata fields `expires_at`, `user_agent`, `last_ip_hash`, `last_ip_country_code`, and `last_used_at`.
   - Which files are affected: `prisma/schema.prisma`.
   - Expected outcome / how to verify: the schema captures the locked fields and rules from `final_plan.md`, including unique Google identity keys, one active challenge per email and purpose, hashed refresh tokens, a stable session anchor for rotation/reuse detection, `reauthenticated_at` for recent re-auth enforcement, the required session lifecycle/metadata fields, personal organizations, device ownership by user, and durable auth-related security events.
   - Potential risks: missing unique constraints, incorrect nullability, or skipping the stable session-family, `reauthenticated_at`, and session lifecycle fields will make replay detection, expiry enforcement, or session management visibility impossible to implement safely later.

3. Create, review, and apply the Phase 1 migration.
   - What to do: generate the first migration for the Phase 1 identity schema, inspect the SQL carefully, apply it to `typetalk_dev`, and confirm it can also run cleanly in `typetalk_test`.
   - Which files are affected: `prisma/migrations/<timestamp>_phase1_identity/*`, optional `prisma/migration_lock.toml`, and possibly `prisma/seed.ts` only if Phase 1 needs non-billing seed helpers.
   - Expected outcome / how to verify: `npx prisma migrate dev` succeeds locally, the generated SQL contains the expected tables/indexes, and `npx prisma migrate reset --force` or the test DB migration path succeeds without manual fixes.
   - Potential risks: a bad migration can block all Phase 1 work, especially if OTP uniqueness, session indexes, or organization ownership constraints are wrong.

4. Add shared auth, identity, and security helper modules.
   - What to do: implement the low-level helpers Phase 1 will rely on, including email normalization, OTP generation and hashing, refresh-token hashing, JWT issuance/verification, Google ID token validation wrapper, and minimal auth-related security-event writing.
   - Which files are affected: expected files include `src/lib/email.ts`, `src/lib/crypto.ts`, `src/lib/tokens.ts`, `src/modules/auth/otp.ts`, `src/modules/auth/jwt.ts`, `src/modules/auth/google.ts`, and `src/modules/security/service.ts`.
   - Expected outcome / how to verify: helper-level tests prove email normalization is stable, OTPs are hashed before storage, refresh tokens are never stored raw, and token helpers produce the configured access/refresh lifetimes.
   - Potential risks: weak helper boundaries make later routes hard to test; storing raw codes or raw refresh tokens would violate the locked security rules.

5. Add repository/service layers for users, organizations, sessions, email challenges, and auth security events.
   - What to do: implement Prisma-backed domain services that encapsulate user lookup/creation, organization creation, email challenge supersession, session creation/revocation/rotation, and durable `security_events` writes.
   - Which files are affected: expected files include `src/modules/users/service.ts`, `src/modules/organizations/service.ts`, `src/modules/auth/repository.ts`, `src/modules/auth/service.ts`, and `src/modules/security/repository.ts`.
   - Expected outcome / how to verify: service-level tests or targeted integration tests prove new users get a personal organization, challenge replacement supersedes older active codes, and session family state can be revoked consistently.
   - Potential risks: mixing route logic and DB logic here will make OTP and refresh flows error-prone and difficult to reason about.

6. Implement `POST /v1/auth/email/request-code`.
   - What to do: add request schema validation, rate limiting, IP-hash capture, active-challenge supersession behavior, OTP generation, code hashing, persistence, and email-delivery integration for the initial OTP request.
   - Which files are affected: expected files include `src/modules/auth/routes.ts`, `src/modules/auth/schemas.ts`, `src/modules/auth/service.ts`, `src/modules/auth/otp.ts`, and any email-delivery adapter such as `src/lib/email-provider.ts`.
   - Expected outcome / how to verify: a valid request creates one active hashed challenge for the email and purpose, stores requested IP hash, sends an OTP through the configured provider or test double, and rejects abusive request rates.
   - Potential risks: leaking raw OTP values into logs/responses, failing to supersede old challenges, or implementing rate limits only in memory would violate the locked requirements.

7. Implement `POST /v1/auth/email/resend-code`.
   - What to do: add the resend endpoint with the same validation and rate limiting rules as request-code, but explicitly supersede the previous active challenge and create a fresh one.
   - Which files are affected: expected files include `src/modules/auth/routes.ts`, `src/modules/auth/schemas.ts`, and `src/modules/auth/service.ts`.
   - Expected outcome / how to verify: resending creates a new active challenge, marks the previous one as superseded, and prevents the older OTP from being reused.
   - Potential risks: forgetting to supersede the old challenge creates parallel valid OTPs and weakens account security.

8. Implement `POST /v1/auth/email/verify-code`.
   - What to do: add OTP verification, database-enforced max-attempt behavior, challenge expiry checks, first-time user creation, personal organization creation, membership creation, device/session linkage, access-token issuance, and refresh-session creation. Session creation must set `expires_at` from the locked 30-day refresh lifetime, persist `user_agent`, store `last_ip_hash` and `last_ip_country_code`, and initialize `last_used_at` when the session is first issued.
   - Which files are affected: expected files include `src/modules/auth/routes.ts`, `src/modules/auth/service.ts`, `src/modules/users/service.ts`, `src/modules/organizations/service.ts`, and `src/plugins/auth.ts`.
   - Expected outcome / how to verify: valid OTP verification signs the user in, creates the user and personal organization on first login, creates a hashed refresh session with the required expiry and metadata fields populated, and invalid or expired codes are rejected with attempt counts updated correctly.
   - Potential risks: race conditions on first-user creation, incorrect attempt counting, or creating sessions without expiry/metadata will make later refresh enforcement and session management incomplete.

9. Implement `POST /v1/auth/google`.
   - What to do: add Google token verification, user lookup by Google `sub`, safe account creation for new users, and collision-safe behavior when an email exists without a linked Google identity.
   - Which files are affected: expected files include `src/modules/auth/routes.ts`, `src/modules/auth/schemas.ts`, `src/modules/auth/google.ts`, and `src/modules/auth/service.ts`.
   - Expected outcome / how to verify: existing linked Google accounts sign in directly, brand-new Google users are created safely, and email-collision cases do not auto-merge silently.
   - Potential risks: unsafe auto-merge behavior can cause account takeover; weak Google token validation can accept forged or expired tokens.

10. Implement `POST /v1/auth/link/google`.
   - What to do: add authenticated account-linking flow with recent re-auth requirements and explicit collision handling. The source of truth for recent re-auth must be the current session's `reauthenticated_at` value, set during successful OTP verify or Google sign-in, and linking must require that timestamp to be within the last 10 minutes. If the window is stale, the route must reject the request and require a fresh primary auth step before linking proceeds.
   - Which files are affected: expected files include `src/modules/auth/routes.ts`, `src/modules/auth/service.ts`, `src/modules/auth/google.ts`, and `src/plugins/auth.ts`.
   - Expected outcome / how to verify: an already authenticated user can link a Google account only when the session has a fresh `reauthenticated_at` timestamp; stale-session attempts are rejected with clear errors, and unsafe link attempts still fail on collision checks.
   - Potential risks: allowing link without a single explicit source of truth for recent re-auth weakens account ownership guarantees and creates inconsistent route behavior.

11. Implement authenticated request context plus refresh and logout flows.
   - What to do: add the auth plugin/decorator that loads the current session context from access tokens, then implement `POST /v1/auth/refresh` and `POST /v1/auth/logout`. The refresh-token model must be concrete: the refresh token carries a stable `session_id` plus an opaque secret, the session row is the family anchor, the stored `refresh_token_hash` is replaced in place on every successful rotation, and `reauthenticated_at` is propagated into the auth context for recent re-auth checks. Refresh must fail when `expires_at` is in the past, and every successful refresh must update `last_used_at`, `last_ip_hash`, `last_ip_country_code`, and the stored `user_agent` to reflect the latest trusted session activity.
   - Which files are affected: expected files include `src/plugins/auth.ts`, `src/modules/auth/routes.ts`, `src/modules/auth/service.ts`, and `src/modules/auth/jwt.ts`.
   - Expected outcome / how to verify: authenticated routes can access the current user/session context; refresh succeeds only when the `session_id` exists, is not expired, and the submitted secret matches the current stored hash; successful refresh rotates the secret in place, updates the session metadata fields, and returns a new access token plus new refresh token; logout revokes the anchored session.
   - Potential risks: if expiry is not enforced, old refresh tokens stay usable too long; if session metadata is not updated on refresh, `GET /v1/sessions` becomes incomplete and security investigations lose useful context.

12. Implement suspicious refresh-token reuse detection and durable auth security logging.
   - What to do: detect refresh attempts using an already rotated or revoked refresh token, revoke the anchored session family, write a durable `security_events` record, and force re-authentication. Use this exact decision tree: if the token references no known session id, return invalid-token without creating a security event; if the session exists and is already revoked, return invalid-token; if the session exists and the submitted secret hash does not match the current stored hash, treat it as suspicious reuse, revoke the session family, and persist a `security_events` record.
   - Which files are affected: expected files include `src/modules/auth/service.ts`, `src/modules/security/service.ts`, `src/modules/security/repository.ts`, and related auth tests.
   - Expected outcome / how to verify: a valid rotated token path succeeds once and rotates the current secret, a stale previously rotated token is treated as suspicious reuse, a random invalid token with no matching session id is rejected without false-positive security events, and a persisted `security_events` row is created for real suspicious reuse.
   - Potential risks: if random invalid tokens and real replays are not distinguished, security noise will grow; if stale-token mismatch on an active session is not treated as suspicious, stolen refresh tokens may stay useful.

13. Implement user and session-management endpoints.
   - What to do: implement `GET /v1/me`, `PATCH /v1/me`, `DELETE /v1/me`, `GET /v1/sessions`, and `DELETE /v1/sessions/:sessionId`, including cursor pagination for session listing and ownership checks for session revocation. `DELETE /v1/me` must be a true soft delete: set `deleted_at`, revoke all active sessions for that user, exclude the user from future active-user lookups, and reject further refresh or authenticated-route access using previously issued sessions. `GET /v1/sessions` must expose safe management metadata such as `id`, `created_at`, `expires_at`, `last_used_at`, `user_agent`, `last_ip_country_code`, and device linkage where present, but must not expose raw `refresh_token_hash` or raw `last_ip_hash`.
   - Which files are affected: expected files include `src/modules/users/routes.ts`, `src/modules/users/service.ts`, `src/modules/users/schemas.ts`, `src/modules/auth/routes.ts`, and pagination helpers already created in Phase 0.
   - Expected outcome / how to verify: authenticated users can read and update profile data, list their active sessions with `limit` and `cursor` plus the safe session metadata fields, revoke a selected session safely, and soft-delete their own account in a way that preserves the row for auditability but blocks future active access.
   - Potential risks: missing ownership checks can allow session revocation across accounts; a soft delete that does not revoke sessions or exclude the user from active lookups leaves deleted accounts effectively alive; exposing raw internal session hashes would create unnecessary security risk.

14. Implement organization endpoints for the personal workspace model.
   - What to do: implement `GET /v1/organizations/current` and `GET /v1/organizations/members`, making sure organization membership comes from the Phase 1 personal organization model and the members endpoint uses cursor pagination.
   - Which files are affected: expected files include `src/modules/organizations/routes.ts`, `src/modules/organizations/service.ts`, `src/modules/organizations/schemas.ts`, and shared pagination helpers.
   - Expected outcome / how to verify: an authenticated user can fetch their current personal organization and list its members through the required API contract.
   - Potential risks: incorrect organization selection logic can break future multi-org readiness; missing pagination again breaks the locked API convention.

15. Add comprehensive automated tests and manual verification for the full Phase 1 flow.
   - What to do: add integration tests and targeted service tests for OTP, Google sign-in, safe Google linking, refresh rotation, suspicious refresh reuse, session listing pagination, organization membership, and auth abuse protections.
   - Which files are affected: expected files include `test/integration/auth.email.test.ts`, `test/integration/auth.google.test.ts`, `test/integration/auth.refresh.test.ts`, `test/integration/users.test.ts`, `test/integration/organizations.test.ts`, and supporting test helpers under `test/helpers/*`.
   - Expected outcome / how to verify: the test suite passes against `typetalk_test`, and manual smoke tests confirm the most important login/session flows work end to end.
   - Potential risks: if tests only cover happy paths, OTP attempt limits, Google collision cases, or refresh replay handling may fail in production.

### Testing Strategy

- Run schema verification first:
  - `npx prisma validate`
  - `npx prisma generate`
  - `npx prisma migrate dev`
  - apply the same migration path to `typetalk_test`
- Run automated integration tests against `typetalk_test` for:
  - OTP request, resend, verify happy path
  - expired OTP rejection
  - max-attempt lockout
  - one-active-challenge supersession
  - first-login user creation with personal organization creation
  - session creation sets `expires_at`, `user_agent`, `last_ip_hash`, `last_ip_country_code`, and `last_used_at`
  - Google sign-in for existing linked user
  - Google sign-in for new user
  - unsafe email-collision case rejected without silent merge
  - authenticated Google linking with fresh recent re-auth
  - authenticated Google linking rejected when `reauthenticated_at` is older than the allowed 10-minute window
  - refresh rotation with the stable session-family model
  - refresh rejected when the anchored session is expired
  - successful refresh updates `last_used_at`, `last_ip_hash`, `last_ip_country_code`, and stored `user_agent`
  - stale previously rotated refresh token treated as suspicious reuse
  - random invalid refresh token rejected without creating a false-positive security event
  - session-family revocation after suspicious refresh-token reuse
  - suspicious refresh-token reuse creating a durable `security_events` record
  - session listing pagination plus safe metadata exposure
  - session revocation
  - organization current/members endpoints
  - soft-deleted user blocked from refresh and authenticated routes
- Run manual or scripted API smoke checks for representative routes:
  - `POST /v1/auth/email/request-code`
  - `POST /v1/auth/email/resend-code`
  - `POST /v1/auth/email/verify-code`
  - `POST /v1/auth/google`
  - `POST /v1/auth/link/google`
  - `POST /v1/auth/refresh`
  - `POST /v1/auth/logout`
  - `GET /v1/me`
  - `GET /v1/sessions`
  - `GET /v1/organizations/current`
  - `GET /v1/organizations/members`
- Confirm API-contract details:
  - list endpoints accept `limit` and `cursor`
  - paginated responses return `items` and `next_cursor`
  - error responses follow the shared error shape
  - no raw OTP codes or refresh tokens are stored in plaintext

### Success Criteria

- Prisma schema and migration exist for all locked Phase 1 tables: `users`, `auth_identities`, `email_challenges`, `sessions`, `organizations`, `organization_members`, `devices`, and minimum auth-related `security_events`.
- Email OTP auth works end to end with the locked rules: 6-digit OTP, 10-minute expiry, max 5 attempts, one active challenge per email and purpose, resend supersession, and request/verify rate limiting.
- Google sign-in works for linked and new users without unsafe silent merges.
- Google account linking requires an authenticated user plus a session `reauthenticated_at` timestamp within the allowed 10-minute window and rejects unsafe collisions.
- A first-time successful sign-in creates a user, a personal organization, and an organization membership record automatically.
- Refresh-token rotation uses a stable session-family anchor, rotates the current stored refresh-token hash in place, rejects random invalid tokens safely, and treats stale-token replay on an active session as suspicious reuse.
- Sessions store and maintain the locked lifecycle/metadata fields: `expires_at`, `user_agent`, `last_ip_hash`, `last_ip_country_code`, and `last_used_at`.
- Refresh rejects expired sessions, and successful refresh updates the session metadata needed for safe session management.
- Logout revokes the anchored session, and suspicious refresh-token reuse revokes the affected session family and persists a `security_events` record.
- `DELETE /v1/me` sets `deleted_at`, revokes all active sessions for that user, removes the user from future active-user lookups, and prevents further refresh or authenticated access through old sessions.
- `GET /v1/me`, `PATCH /v1/me`, `DELETE /v1/me`, `GET /v1/sessions`, `DELETE /v1/sessions/:sessionId`, `GET /v1/organizations/current`, and `GET /v1/organizations/members` are implemented and verified, and `GET /v1/sessions` exposes safe session metadata without leaking internal hashes.
- Collection endpoints in Phase 1 use the shared cursor pagination contract.
- The Phase 1 automated test suite passes against `typetalk_test`.
- Manual smoke tests confirm a user can sign in on a clean account, refresh a session, inspect sessions, and read their personal organization successfully.
