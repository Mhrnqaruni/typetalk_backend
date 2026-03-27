## Phase 2 Execution Review - Round 1
### Overall Assessment
Phase 2 is mostly implemented, and most of the execution report matches the current codebase. I re-read the source plan and approved Phase 2 plan, inspected the actual schema/modules/tests, and reran `npx prisma validate`, `npx prisma generate`, `npx prisma migrate status`, test-DB `npx prisma migrate deploy`, `npm run build`, and `npm run test`; all passed. The blocking defect is in the shared idempotency layer: `expires_at` is stored and indexed, but the replay path never enforces it, so expired keys still replay stale responses and suppress the underlying business write.

### Verified Claims
Step 1: PARTIALLY_VERIFIED - The current tree shows the intended refactor target and the full suite passes, but the claimed untouched pre-edit Phase 1 baseline cannot be rerun from the current workspace because that baseline code no longer exists.

Step 2: VERIFIED - `prisma/schema.prisma` contains `UserPreference`, `DictionaryEntry`, `WritingProfile`, `AppProfile`, and `IdempotencyKey` with the expected defaults, relations, uniqueness, and indexes, including `@@unique([userId, organizationId, appKey])` and `@@id([scope, idempotencyKey])`.

Step 3: VERIFIED - The Phase 2 migration exists at `prisma/migrations/20260325161514_phase2_preferences_devices_sync/migration.sql`. I reran `npx prisma migrate status` on dev and `npx prisma migrate deploy` against `typetalk_test`; both reported the schema up to date with no pending migrations.

Step 4: PARTIALLY_VERIFIED - `src/lib/idempotency.ts`, `src/lib/json-bounds.ts`, and the hashing support in `src/lib/crypto.ts` exist and compile, and the JSON bounds contract is implemented. However, the idempotency helper ignores `expiresAt` when replaying an existing key, so the shared idempotency infrastructure is incomplete.

Step 5: VERIFIED - Device persistence now lives in `src/modules/devices/*`; `AuthRepository` no longer owns device upsert logic, and `AuthService` uses `DeviceService` for sign-in device handling. Phase 1 auth coverage still passes under the full suite.

Step 6: PARTIALLY_VERIFIED - `POST /v1/devices/register` is implemented, requires `Idempotency-Key`, uses actor-scoped idempotency, and the integration suite covers same-key replay/conflict/concurrency/cross-user isolation. But expired keys still replay stale responses instead of allowing the business write to run again.

Step 7: VERIFIED - `PATCH /v1/devices/:deviceId/heartbeat` exists, updates mutable metadata plus `last_seen_at`, and rejects foreign/nonexistent devices safely.

Step 8: VERIFIED - `GET /v1/devices` uses authenticated ownership filtering plus stable cursor pagination over `lastSeenAt desc, id desc`, and the device pagination tests pass.

Step 9: VERIFIED - `DELETE /v1/devices/:deviceId` revokes linked sessions and deletes only owned devices inside a serializable transaction. The integration suite confirms foreign-delete rejection, post-delete absence, and slot reuse.

Step 10: VERIFIED - `GET /v1/preferences` and `PUT /v1/preferences` are implemented with the exact locked defaults and full-replacement semantics, and the preferences integration tests cover both.

Step 11: VERIFIED - Dictionary create/list routes are implemented with user-plus-organization scoping and cursor pagination, and the integration coverage verifies isolation.

Step 12: VERIFIED - Dictionary patch/delete routes are implemented with owned-resource filtering and 404 behavior for foreign or missing entries.

Step 13: VERIFIED - Writing-profile list/create/patch routes exist, are organization-scoped, and enforce the bounded `rules_json` contract. The Prisma JSON handling compiles cleanly and the boundary tests pass.

Step 14: VERIFIED - App-profile list/upsert exists with one stable row per user plus organization plus `appKey`, bounded `settings_json`, and writing-profile ownership validation before upsert.

Step 15: PARTIALLY_VERIFIED - `src/app.ts` registers the new modules, `test/helpers/db.ts` truncates the Phase 2 tables, and the Prisma/build/test verification matrix passes. But the report's "No open functional issues" claim is false because the shared idempotency expiry path is still broken and untested.

### Issues Found
- [HIGH] Idempotency expiry is non-functional - `prisma/schema.prisma:235-245`, `src/lib/idempotency.ts:58-67`, `src/lib/idempotency.ts:99-132`, `src/modules/devices/service.ts:55-77` - The code writes and indexes `expires_at`, but the conflict/replay path never checks whether the stored row is already expired. I verified this directly by registering a device through `POST /v1/devices/register`, manually backdating the matching `idempotency_keys.expires_at` row in the test DB to one minute in the past, waiting 1.2 seconds, and sending the same request again with the same key and payload. The second request still returned `200` with the original `last_seen_at`, and the `devices.last_seen_at` value in the database did not move. That means expired keys keep suppressing real writes indefinitely, so the shared idempotency layer is incorrect for Phase 2 and unsafe to reuse for later billing/usage routes. Fix: in `executeIdempotentRequest`, treat `expiresAt <= now` as expired before replay/conflict decisions, clear or replace expired rows transactionally, and add an integration test that backdates an idempotency row and verifies the second registration re-executes the upsert and advances `last_seen_at`.

### Verdict
VERDICT: NEEDS_REVISION
