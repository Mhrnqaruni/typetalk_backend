## Phase 1 Execution Review - Round 5

### Overall Assessment
I re-read `final_plan.md`, `phase_1/plan_approved.md`, and `phase_1/exec_report.md`, then re-verified the current implementation from the actual source tree and by running the app. The previous Round 4 approval was incorrect. `npm test` still passes with 7 passing files / 15 passing tests, but direct runtime repros show that Phase 1 still has three real defects: production email OTP delivery is still wired to a logging stub, parallel refresh requests falsely trigger suspicious-reuse revocation, and parallel OTP verification can reuse one valid code to mint two sessions. Additional medium-risk gaps remain around auth rate limiting and device-cap enforcement under concurrency.

### Verified Claims
Step 1: VERIFIED - The Phase 0 scaffold still exists and the app boots through the test harness; `npm test` passes on the current tree.

Step 2: VERIFIED - The Phase 1 Prisma models are present in `prisma/schema.prisma`, including users, identities, sessions, organizations, organization members, devices, email challenges, and security events.

Step 3: VERIFIED - The Phase 1 migration files still exist under `prisma/migrations/` and the current code depends on them.

Step 4: PARTIALLY_VERIFIED - Shared auth helpers exist, but the only checked-in email provider implementation is `LoggingEmailProvider` in `src/lib/email-provider.ts:11`, and runtime `buildApp` still defaults to it in `src/app.ts:34`.

Step 5: PARTIALLY_VERIFIED - The repository/service layer exists, but it still contains non-atomic auth-critical flows in `src/modules/auth/service.ts:96`, `src/modules/auth/service.ts:123`, `src/modules/auth/service.ts:299`, `src/modules/auth/service.ts:319`, `src/modules/auth/repository.ts:121`, and `src/modules/auth/repository.ts:259`.

Step 6: PARTIALLY_VERIFIED - `POST /v1/auth/email/request-code` exists, stores hashed challenge data, and recent-request checks work, but the runtime delivery path still logs OTPs instead of sending them and there is still no route-level/per-IP limiter.

Step 7: PARTIALLY_VERIFIED - `POST /v1/auth/email/resend-code` exists and supersedes prior challenges, but it inherits the same provider and rate-limiting gaps as request-code.

Step 8: FAILED_VERIFICATION - I reproduced two parallel `POST /v1/auth/email/verify-code` calls with the same valid OTP; both returned `200`, and the database ended with two sessions for the same user. One-time OTP use is not enforced under concurrency.

Step 9: VERIFIED - Google sign-in is implemented and the current tests still cover linked-user, new-user, and collision-safe behavior.

Step 10: VERIFIED - Google linking with recent re-auth is still implemented and covered by the passing suite.

Step 11: FAILED_VERIFICATION - I reproduced two parallel `POST /v1/auth/refresh` calls with the same refresh token; one returned `200`, the other returned `401 reauth_required`, and the new token from the `200` response immediately failed on the next refresh with `401 invalid_refresh_token`. Refresh rotation is not safe under legitimate concurrency.

Step 12: FAILED_VERIFICATION - Suspicious refresh-reuse handling exists, but it misclassifies a normal parallel refresh race as token theft because rotation is not guarded by an atomic compare-and-swap update.

Step 13: VERIFIED - `GET /v1/me`, `PATCH /v1/me`, `DELETE /v1/me`, `GET /v1/sessions`, and `DELETE /v1/sessions/:sessionId` still exist, and the earlier deleted-email/session-list fixes remain intact in the passing suite.

Step 14: PARTIALLY_VERIFIED - `GET /v1/organizations/current` and `GET /v1/organizations/members` work for personal-org Phase 1 behavior, but current-organization selection is still placeholder oldest-membership logic in `src/modules/organizations/service.ts:47` and `src/modules/organizations/service.ts:52`.

Step 15: PARTIALLY_VERIFIED - The automated suite exists and passes, but it still misses the parallel verify-code and parallel refresh failures. Current concurrency coverage only checks parallel request-code in `test/integration/auth.email.test.ts:70`, while refresh coverage remains sequential in `test/integration/auth.refresh.test.ts:52`.

### Issues Found
- [HIGH] Production email OTP delivery is still a logging stub - `src/app.ts:34`, `src/server.ts:8`, `src/lib/email-provider.ts:11`, `src/lib/email-provider.ts:13` - the default runtime path instantiates `LoggingEmailProvider`, which only writes the OTP to logs. On Railway, email sign-in would not actually deliver codes and OTP values would leak into application logs. Fix by adding a real provider implementation selected by config for non-test runtimes and failing startup if a real provider is not configured. Verify by starting the app without test injection, calling `POST /v1/auth/email/request-code`, and confirming the OTP is sent through the configured mail service while no OTP value appears in logs.
- [HIGH] Parallel refresh requests falsely trigger token-theft handling and revoke a valid session - `src/modules/auth/service.ts:299`, `src/modules/auth/service.ts:319`, `src/modules/auth/repository.ts:259` - the code reads the session, compares the submitted hash, and then blindly overwrites `refresh_token_hash`. A second in-flight request sees the rotated hash and is treated as suspicious reuse. I reproduced this directly: two parallel refresh calls returned `200` and `401 reauth_required`, and the new token from the `200` response then failed with `401 invalid_refresh_token` because the session had already been revoked. Fix with an atomic compare-and-swap rotation on the current hash/revocation state inside one transaction, and treat "lost the race to a concurrent refresh" differently from confirmed reuse. Verify by replaying the same parallel refresh repro and confirming only one request succeeds while the winning token remains usable on the next refresh.
- [HIGH] OTP verification is not one-time under concurrency - `src/modules/auth/service.ts:96`, `src/modules/auth/service.ts:123`, `src/modules/auth/repository.ts:90`, `src/modules/auth/repository.ts:121` - the active challenge is loaded before the transaction and later marked used by id only, so two parallel verify requests can both consume the same still-unused row. I reproduced this directly: two parallel `POST /v1/auth/email/verify-code` calls with the same valid code both returned `200` and created two sessions for the same user. Fix by consuming the challenge atomically inside the transaction with a conditional update (`used_at IS NULL`, `superseded_at IS NULL`, and not expired) or an equivalent row lock, and only issue a session when that consume step succeeds. Verify by replaying the parallel verify repro and confirming exactly one request can succeed.
- [MEDIUM] Auth endpoint rate limiting is still incomplete for the Phase 1 plan - `src/app.ts:121`, `src/modules/auth/service.ts:519`, `src/modules/auth/service.ts:527` - the code enforces per-email request counts and per-challenge OTP attempt limits, but there is still no route-level/per-IP limiter plugin or equivalent request throttling on `request-code` and `verify-code`. That leaves room for IP spraying and mail-provider abuse even though the plan required auth endpoint rate limiting. Fix by adding explicit route-level rate limiting keyed at least by route plus IP, while keeping the existing DB-backed per-email and per-challenge protections as a second layer. Verify by sending repeated requests from one IP across many emails and confirming the limiter trips before challenge creation or OTP delivery.
- [MEDIUM] Device-cap enforcement is still race-prone by inspection - `src/modules/auth/repository.ts:162`, `src/modules/auth/repository.ts:173`, `src/modules/auth/repository.ts:197`, `src/modules/auth/repository.ts:205` - `upsertDeviceForUser` still does `findUnique -> count -> create` with no lock or DB-backed guard, so concurrent new-device sign-ins near the cap can overshoot `MAX_ACTIVE_DEVICES_PER_USER`. I did not reproduce this one yet because OTP request throttling interfered with fast seeding, but the code path is still vulnerable. Fix by enforcing the cap transactionally or with a constraint-backed invariant and add a concurrent regression test. Verify by seeding a user to `max - 1` devices and firing parallel new-device sign-ins.
- [LOW] Current-organization selection is still placeholder oldest-membership logic - `src/modules/organizations/service.ts:47`, `src/modules/organizations/service.ts:52` - this is acceptable for personal-org-only Phase 1, but it does not establish explicit current-org state and will become ambiguous once multi-org membership exists. Fix before the multi-org phase by storing current organization in session/request context or adding a deterministic selection rule plus switch endpoint. Verify by giving one user multiple memberships and asserting the intended current-organization behavior.

### Verdict
VERDICT: NEEDS_REVISION
