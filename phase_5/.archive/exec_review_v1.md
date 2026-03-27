## Phase 5 Execution Review - Round 1
### Overall Assessment
Phase 5 is mostly implemented as planned: the new Prisma models and migration exist, the `usage` module is wired into the app, the realtime-session, finalize, telemetry, quota, and summary paths are live, and the broader regression matrix still passes. I verified this by reading the actual code in `src/modules/usage/*`, `src/app.ts`, `test/helpers/*`, and `prisma/*`, then running `npm run prisma:validate`, `npm run prisma:generate`, `npx prisma migrate status`, test-DB `npx prisma migrate deploy`, test-DB `npx prisma db seed`, `npm run build`, `npx vitest run test/integration/usage.test.ts`, `npm test`, and a representative end-to-end smoke flow.

The phase is not approval-ready. The trusted settlement path accepts a `COMPLETED` session without a trusted `final_word_count`, silently coerces it to `0`, and then allows `POST /v1/usage/finalize` to create a finalized usage row that spends zero quota. That violates the locked Phase 5 requirement that quota spending only occur when trusted final usage is actually available.

### Verified Claims
Step 1: PARTIALLY_VERIFIED - current Phase 5 code builds and the full test suite passes (`npm run build`, `npm test`), so the project is stable now; the executor's historical claim about the exact pre-edit baseline cannot be independently re-run after the fact.

Step 2: PARTIALLY_VERIFIED - the codebase does define the Phase 5 contract surface in `src/modules/usage/schemas.ts`, `src/modules/usage/service.ts`, `src/modules/usage/repository.ts`, and `src/modules/usage/routes.ts`, and the schema includes the required fields in `prisma/schema.prisma`; however, the trusted-result contract is not enforced correctly because `COMPLETED` settlement accepts an omitted `finalWordCount` and stores `0` instead.

Step 3: VERIFIED - `prisma/schema.prisma` contains the new `RealtimeSessionStatus` and `UsageEventStatus` enums plus `RealtimeSession`, `QuotaWindow`, `UsageEvent`, and `UsageRollupWeekly` with the required relations and uniqueness constraints (`prisma/schema.prisma:95-102`, `prisma/schema.prisma:458-553`).

Step 4: VERIFIED - the generated migration exists at `prisma/migrations/20260326113841_phase5_usage_and_quota/migration.sql`, `npx prisma migrate status` reports the dev database is up to date, and test-DB `npx prisma migrate deploy` reports no pending migrations.

Step 5: VERIFIED - the new module is scaffolded and registered: `src/app.ts` imports `buildUsageRoutes`, constructs `UsageRepository` and `UsageService`, and registers the usage routes under `/v1` (`src/app.ts:35-37`, `src/app.ts:78-86`, `src/app.ts:200-201`).

Step 6: VERIFIED - repository support and UTC week math are implemented in `src/modules/usage/repository.ts` and `src/modules/usage/window.ts`; the Monday 00:00 UTC rollover behavior is also exercised by `test/integration/usage.test.ts`.

Step 7: VERIFIED - `POST /v1/realtime/session` is implemented in `src/modules/usage/routes.ts:34-46`, validates auth/device ownership through `UsageService.createRealtimeSession`, and the integration suite confirms owned-device success plus foreign-device rejection.

Step 8: PARTIALLY_VERIFIED - a real internal trusted settlement path exists in `UsageService.settleTrustedRealtimeSession` and I verified it through a live harness smoke flow, but it is incorrect for a launch-critical edge case: a `COMPLETED` settlement without `finalWordCount` is accepted and persisted as `final_word_count: 0` instead of being rejected.

Step 9: PARTIALLY_VERIFIED - `POST /v1/usage/finalize` requires auth and `Idempotency-Key`, rejects untrusted sessions, and replays idempotently on the happy path (`src/modules/usage/routes.ts:48-61`, `src/modules/usage/service.ts:225-365`), but its trust guarantee is undermined by Step 8 because it accepts the malformed trusted settlement as billable-ready.

Step 10: PARTIALLY_VERIFIED - the serializable quota/event/rollup transaction is implemented and the concurrency test passes, but the transaction is only as trustworthy as the session data it consumes. Because Step 8 can write `final_word_count = 0` for a malformed `COMPLETED` settlement, finalize can create a `FINALIZED` usage event and leave quota unchanged for a session whose trusted final count was never actually supplied.

Step 11: VERIFIED - `POST /v1/usage/events` is implemented as telemetry-only in `src/modules/usage/routes.ts:63-75` and `src/modules/usage/service.ts:367-438`; both the integration test and the live smoke flow confirmed telemetry leaves quota and trusted summary unchanged.

Step 12: VERIFIED - `GET /v1/usage/quota` and `GET /v1/usage/summary` are implemented in `src/modules/usage/routes.ts:77-98`; on the happy path they return the expected weekly window, plan context, used words, and trusted rollup totals, and telemetry remains excluded from those trusted counters.

Step 13: PARTIALLY_VERIFIED - `test/integration/usage.test.ts` exists, the harness exposes `usageService` in `test/helpers/app.ts`, and the DB reset includes the new tables in `test/helpers/db.ts`; however, the targeted suite missed the malformed-settlement case because the helper always supplies a default `finalWordCount` (`test/integration/usage.test.ts:107-133`), so the critical trusted-result validation hole was not covered.

Step 14: VERIFIED - I reran the execution matrix directly: `npm run prisma:validate`, `npm run prisma:generate`, `npx prisma migrate status`, test-DB `npx prisma migrate deploy`, test-DB `npx prisma db seed`, `npm run build`, `npx vitest run test/integration/usage.test.ts`, `npm test`, and a representative create-settle-finalize-quota-summary-telemetry smoke flow. All of those commands pass in the current workspace, aside from the separate functional bug described below.

### Issues Found
- [HIGH] Missing trusted `final_word_count` is silently accepted for `COMPLETED` settlements, which lets finalize create zero-word billable events and bypass quota enforcement - `src/modules/usage/service.ts:135-141`, `src/modules/usage/service.ts:206`, with downstream impact in `src/modules/usage/service.ts:268-317` - the Phase 5 contract requires finalize to spend quota only when trusted final usage is actually available, but the service only rejects `finalWordCount === null`, not `undefined`, then coerces an omitted value to `0`. I reproduced this directly through the live harness: calling `settleTrustedRealtimeSession` with `status: "COMPLETED"` and no `finalWordCount` succeeded and persisted `final_word_count: 0`; a subsequent `POST /v1/usage/finalize` returned `200` and produced a `FINALIZED` usage row with `word_count: 0`, `used_words: 0`, and an unchanged free quota window. Fix: reject both `null` and `undefined` for `COMPLETED` trusted settlements, do not default missing trusted billable counts to `0`, keep the session unsettled on invalid payloads, and add a regression that proves finalize stays blocked until a real trusted final count is written.
- [MEDIUM] The Phase 5 integration suite does not cover the malformed-settlement path that caused the production bug above - `test/integration/usage.test.ts:107-133` - the helper injects `finalWordCount: overrides?.finalWordCount ?? 321`, so none of the tests exercise a `COMPLETED` settlement with the trusted final count omitted. That left the contract hole undetected even though the happy-path suite is green. Fix: add explicit negative tests for omitted trusted fields on `COMPLETED` settlement, assert the session remains untrusted/open after rejection, and assert `POST /v1/usage/finalize` still returns `trusted_usage_unavailable`.

### Verdict
VERDICT: NEEDS_REVISION
