## Phase 1 Execution Review — Round 3

### Overall Assessment
Phase 1 is materially implemented now. I verified that the Prisma schema, migration, auth/users/organizations/security modules, and Phase 1 integration tests all exist in the actual codebase. I also reran `npx prisma validate`, `npx prisma migrate status`, `npx tsc -p tsconfig.json --noEmit`, and `npm run test`, and all of them succeeded locally, so the foundation and most of the implementation are real.

The execution report still overstates correctness. Direct runtime verification exposed two functional bugs in locked Phase 1 behavior, and code review exposed one additional error-handling security defect plus one missing database guarantee around OTP challenge uniqueness. Because these issues sit in core auth and session-management behavior, Phase 1 is not approvable.

### Verified Claims
Step 1: PARTIALLY_VERIFIED — The Phase 0 foundation is working. The scaffold files are present, `npx prisma validate` and `npx prisma migrate status` pass, `npx tsc -p tsconfig.json --noEmit` passes, and `npm run test` passes. I did not rerun mutating commands such as `npx prisma generate` or `npm run build`; I used read-only equivalents where possible.

Step 2: PARTIALLY_VERIFIED — The approved Phase 1 enums and models exist in `prisma/schema.prisma`, but the `users` table still enforces a global unique `primary_email`, which violates the locked "unique normalized email for active users" rule.

Step 3: PARTIALLY_VERIFIED — The Phase 1 migration exists and is applied, but it bakes in the same global-email-uniqueness defect from Step 2.

Step 4: VERIFIED — Shared auth/email/crypto/token/pagination helpers and the expanded env configuration are present and compile.

Step 5: PARTIALLY_VERIFIED — Repository/service layers exist and are exercised by tests, but the service behavior is still wrong in soft-delete email reuse and session listing.

Step 6: PARTIALLY_VERIFIED — `POST /v1/auth/email/request-code` works on the happy path, but the "one active challenge per email + purpose" rule is not enforced at the database level.

Step 7: PARTIALLY_VERIFIED — `POST /v1/auth/email/resend-code` works on the happy path, but it shares the same missing database guarantee for a single active challenge.

Step 8: PARTIALLY_VERIFIED — `POST /v1/auth/email/verify-code` works for normal sign-in, but after soft-deleting a user the same email path fails with a Prisma unique-constraint 500 instead of supporting active-user-only uniqueness.

Step 9: VERIFIED — `POST /v1/auth/google` exists and the tested linked/new/collision flows pass.

Step 10: VERIFIED — `POST /v1/auth/link/google` exists and the fresh/stale re-auth checks work in tests.

Step 11: VERIFIED — Access-token auth, refresh rotation, metadata updates, and logout are implemented and the refresh tests pass.

Step 12: VERIFIED — Suspicious refresh-token reuse detection and durable `security_events` writing are implemented and tested.

Step 13: PARTIALLY_VERIFIED — The user/session routes exist, but `GET /v1/sessions` returns revoked sessions and the soft-delete model does not permit clean re-signup for a deleted email.

Step 14: VERIFIED — Organization current/members routes exist and pass pagination tests.

Step 15: PARTIALLY_VERIFIED — The integration suite exists and passes, but it missed the deleted-email reuse and active-session-only listing cases, so it does not fully prove the locked behavior.

### Issues Found
- [HIGH] Soft delete does not satisfy the locked "unique normalized email for active users" rule — `prisma/schema.prisma:50-67`, `src/modules/users/service.ts:25-56`, `src/modules/auth/service.ts:143-156` — `users.primary_email` is globally unique, while auth lookup intentionally ignores deleted users. I reproduced the failure directly: sign in as `reuse@example.com`, call `DELETE /v1/me`, then sign in again with the same email; the second `POST /v1/auth/email/verify-code` returns `500` because `transaction.user.create()` hits a `primary_email` unique-constraint violation. This breaks account recreation after soft delete and contradicts the locked schema rules. Fix: enforce uniqueness only for active users, update the migration, and add a regression test that deletes a user then signs in again with the same email. Verify by rerunning that exact flow and confirming a fresh account/session is created instead of a 500.
- [MEDIUM] `GET /v1/sessions` lists revoked sessions instead of only active sessions — `src/modules/users/service.ts:102-165` — the query filters only by `userId`; it does not exclude `revokedAt != null` or expired sessions. I reproduced this directly: after creating two sessions and revoking one through `DELETE /v1/sessions/:sessionId`, `GET /v1/sessions?limit=10` still returned both sessions, including one with `revoked_at` populated. The approved plan says this route should list the user's active sessions. Fix: filter the query to active sessions, keep pagination stable, and add a regression test that revokes a session before listing. Verify by repeating the revoke-and-list flow and confirming only active sessions are returned.
- [MEDIUM] Unhandled server errors leak internal implementation details to clients — `src/app.ts:67-108` — the generic error handler returns `error.message` for 5xx responses. In the deleted-email repro above, the API exposed raw Prisma invocation text and the local filesystem path inside the `internal_error` response body. That is an information disclosure bug and should not reach clients in production. Fix: return a generic 5xx message while logging the full exception server-side, and map known Prisma errors to domain-level `AppError`s where appropriate. Verify by rerunning the deleted-email repro or another forced 5xx and confirming the client no longer receives Prisma/file-path details.
- [MEDIUM] The "one active challenge per email + purpose" rule is not guaranteed by the database — `prisma/schema.prisma:84-97`, `src/modules/auth/service.ts:63-91` — the schema has only a non-unique index on `email_challenges`, and request/resend do a supersede-then-create sequence outside a transaction. The happy-path tests pass, but there is no database-level guard against concurrent request/resend races producing overlapping active OTPs, which is a locked auth rule. Fix: add a database-enforced active-challenge uniqueness constraint, wrap supersede/create in one transaction, and add a concurrent request regression test. Verify by issuing parallel request-code or resend calls and confirming only one active challenge remains.

### Verdict
VERDICT: NEEDS_REVISION
