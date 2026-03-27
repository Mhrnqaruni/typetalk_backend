## Phase 1 Plan Review - Round 1

### Overall Assessment
The Phase 1 plan is substantially better than a typical phase plan: it maps well to the approved master plan, covers the required route surface, includes a real testing strategy, and is organized into concrete implementation steps instead of vague themes. The OTP, Google sign-in, session-management, organization, and test-coverage sections are generally strong. I do not approve it yet because a few security-critical behaviors are still underspecified enough that the executor could implement them incorrectly while still claiming to have followed the plan.

### Issues Found
- [HIGH] Refresh-token family/reuse design is not concrete enough - where: `phase_1/plan.md:79-89`, `phase_1/plan.md:155`; locked requirement in `final_plan.md:350` and `final_plan.md:821-826` - fix suggestion: explicitly define the refresh-session model that makes rotation and replay detection possible. The plan currently says to rotate refresh tokens, revoke the session family, and detect reuse, but it never states how the refresh token identifies its session/family after rotation. Add one concrete design, for example: refresh token carries a stable session id plus opaque secret; the session row is the family anchor; the current token hash is replaced on rotation; any later mismatch for that same session id is treated as suspicious reuse and revokes the family. Then add tests for valid rotation, stale-token replay, random invalid token, and family-wide revocation.
- [MEDIUM] Recent re-auth for `POST /v1/auth/link/google` is still a requirement without an implementation design - where: `phase_1/plan.md:73-77`, `phase_1/plan.md:125`, `phase_1/plan.md:153`; locked requirement in `final_plan.md:810` - fix suggestion: define the exact source of truth for "recent re-auth" before implementation starts. The plan should say whether this is based on a session field such as `reauthenticated_at`, an access-token/auth claim such as `auth_time`, or a fresh OTP/Google-auth challenge completed within a defined time window. Also add measurable verification for both fresh and stale-session linking attempts.
- [MEDIUM] `DELETE /v1/me` is treated too loosely for a locked Phase 1 route - where: `phase_1/plan.md:91-95`; related schema rule in `final_plan.md:280` - fix suggestion: replace "soft-delete their account if supported by the implementation" with a concrete required behavior. The final plan already says soft delete is supported, so the Phase 1 plan should specify `deleted_at`-based deletion, what happens to active sessions on delete, and how the account is excluded from future active-user lookups while preserving auditability. Add verification that deleted users cannot continue to refresh or use authenticated routes.

### Positive Aspects
- The plan covers the full approved Phase 1 route surface from the master plan, including the previously easy-to-miss organization and session-management endpoints.
- The step structure is concrete and actionable: each step says what to do, which files are affected, how to verify it, and what can go wrong.
- The test strategy is much better than average and includes the important edge cases: OTP supersession, max-attempt behavior, unsafe Google email collisions, refresh replay, pagination, and organization membership.
- The plan correctly treats Phase 0 readiness as a hard gate instead of assuming the scaffold exists.
- The plan explicitly carries forward the shared API-contract requirements from Phase 0, including pagination and standardized error behavior.

### Verdict
VERDICT: NEEDS_REVISION
