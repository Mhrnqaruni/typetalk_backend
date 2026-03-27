## Phase 2 — Implementation Plan

### Objective

Phase 2 adds the first real cross-device sync layer for TypeTalk. At the end of this phase, an authenticated user must be able to register and manage devices, store synced preferences and profile data, and repeat device-registration requests safely through server-side idempotency without creating duplicate state.

### Prerequisites

- Phase 1 must be completed and re-verified before implementation starts. `project_status.md` already marks Phase 1 as completed, but the current code and tests still need to be treated as the runtime baseline for this phase.
- The existing Phase 1 backend must still build and test cleanly, including auth, personal-organization resolution, session handling, and the shared cursor-pagination helper in `src/lib/pagination.ts`.
- The current Phase 1 schema and migrations must already be applied to `typetalk_dev` and `typetalk_test`.
- The existing auth flow already provisions or updates `devices` rows during sign-in through `src/modules/auth/service.ts` and `src/modules/auth/repository.ts`; Phase 2 must preserve that behavior while moving long-term device ownership into a dedicated devices module.
- `src/app.ts` must still be the central route-registration point, and `test/helpers/app.ts` plus `test/helpers/db.ts` must remain the shared test harness for new integration coverage.
- No Phase 3 billing or entitlement assumptions should leak into this phase. Phase 2 is limited to device sync, preferences data, and the shared `idempotency_keys` infrastructure needed in later phases.

### Steps

1. Confirm the Phase 1 baseline and current device/auth coupling before changing code.
   - What to do: rerun the current Phase 1 verification baseline, inspect `prisma/schema.prisma`, `src/app.ts`, `src/modules/auth/service.ts`, `src/modules/auth/repository.ts`, `src/modules/users/service.ts`, and the test helpers, and document exactly where device creation, pagination, auth context, and organization context already live.
   - Which files are affected: no code changes expected; review `prisma/schema.prisma`, `src/app.ts`, `src/modules/auth/service.ts`, `src/modules/auth/repository.ts`, `src/lib/pagination.ts`, `test/helpers/app.ts`, and `test/helpers/db.ts`.
   - Expected outcome / how to verify: `npm run build` and `npm run test` still pass before any Phase 2 changes, and there is a clear map of which existing code paths must be reused or refactored rather than duplicated.
   - Potential risks: starting Phase 2 without reconciling the existing auth-owned device path can create two conflicting device-registration implementations.

2. Extend the Prisma schema for Phase 2 data and constraints.
   - What to do: update `prisma/schema.prisma` to add `user_preferences`, `dictionary_entries`, `writing_profiles`, `app_profiles`, and `idempotency_keys`, plus the relations, indexes, and uniqueness rules needed for Phase 2 behavior. At minimum, make `user_preferences.user_id` unique, make `app_profiles` unique per user plus organization plus `app_key`, and define the stored request/response shape for `idempotency_keys` with `scope`, `idempotency_key`, `request_hash`, `response_status`, `response_body_json`, `created_at`, and `expires_at`.
   - Which files are affected: `prisma/schema.prisma`.
   - Expected outcome / how to verify: the schema matches the locked Phase 2 tables from `final_plan.md`, records preference/profile data at user plus organization scope where required, and introduces the database constraints needed for device-registration idempotency and safe profile upserts.
   - Potential risks: weak uniqueness or missing foreign keys will make app-profile upsert, ownership checks, and idempotent replay unreliable.

3. Create, inspect, and apply the Phase 2 migration.
   - What to do: generate the Phase 2 Prisma migration, inspect the SQL before applying it, run it against `typetalk_dev`, and verify the same migration path works for `typetalk_test`.
   - Which files are affected: `prisma/migrations/<timestamp>_phase2_preferences_and_devices/*`, and `prisma/migration_lock.toml` only if Prisma updates it.
   - Expected outcome / how to verify: `npx prisma migrate dev` succeeds, the generated SQL contains the expected Phase 2 tables and constraints, and the migration path can be replayed cleanly in the test database.
   - Potential risks: a bad migration will block every route in the phase; the biggest failure modes are incorrect unique indexes for app profiles and broken relation wiring back to `users` or `organizations`.

4. Add shared Phase 2 infrastructure for idempotency and bounded JSON validation.
   - What to do: create the reusable code that Phase 2 and later phases will share for idempotent writes and profile payload validation. This should include a small idempotency helper/service for request-hash generation, stored-response replay, and key-collision detection, plus Zod helpers or module-level validators for bounded `rules_json` and `settings_json` payloads.
   - Which files are affected: expected new or modified files include `src/lib/crypto.ts`, `src/lib/app-error.ts`, `src/lib/idempotency.ts`, `src/modules/devices/schemas.ts`, `src/modules/preferences/schemas.ts`, and possibly `src/config/env.ts` only if one shared idempotency-expiry setting is added.
   - Expected outcome / how to verify: the codebase has one reusable way to say "same idempotency key plus same request hash returns the stored response; same key plus different request hash returns a conflict," and preference/profile JSON inputs are validated before they reach Prisma.
   - Potential risks: implementing ad hoc idempotency inside only one route will make Phase 3 and Phase 5 harder; accepting unbounded JSON blobs increases the chance of inconsistent or oversized synced profile data.

5. Extract device persistence into a dedicated devices module without breaking Phase 1 sign-in.
   - What to do: move or refactor the long-term device logic out of `AuthRepository` into a dedicated `devices` module, then update the auth service to depend on that shared device path instead of owning a second copy of device upsert logic. Preserve the current serialized max-device enforcement and installation-id upsert behavior from Phase 1.
   - Which files are affected: expected files include new `src/modules/devices/repository.ts`, `src/modules/devices/service.ts`, `src/modules/devices/schemas.ts`, plus changes to `src/modules/auth/service.ts`, `src/modules/auth/repository.ts`, and `src/app.ts`.
   - Expected outcome / how to verify: there is one authoritative path for device creation/update, Phase 1 sign-in tests still pass unchanged, and the dedicated devices service can now be reused by the new device routes.
   - Potential risks: if the extraction changes auth-side semantics, existing sign-in flows may stop updating `last_seen_at` or enforcing the active-device cap correctly.

6. Implement `POST /v1/devices/register` with idempotent behavior.
   - What to do: add the authenticated device-registration route, require installation UUID plus platform and optional metadata, route it through the shared devices service, and apply the new `idempotency_keys` flow so repeated requests with the same key and same payload return the same stored result instead of creating duplicate device state. Reuse the existing device-cap enforcement and user ownership rules.
   - Which files are affected: expected files include `src/modules/devices/routes.ts`, `src/modules/devices/schemas.ts`, `src/modules/devices/service.ts`, `src/modules/devices/repository.ts`, `src/lib/idempotency.ts`, and `src/app.ts`.
   - Expected outcome / how to verify: the first valid request creates or refreshes one device row for the authenticated user, a repeated request with the same idempotency key and same payload returns the stored response, a repeated key with a different payload returns a conflict, and no duplicate `(user_id, installation_id)` rows appear.
   - Potential risks: if idempotency is not wired at the database-backed response level, retries from the client can still create duplicate business behavior under network races.

7. Implement `PATCH /v1/devices/:deviceId/heartbeat`.
   - What to do: add an authenticated heartbeat route that updates `last_seen_at` and mutable device metadata such as app version, OS version, locale, timezone, and device name for an owned device without changing ownership or installation identity.
   - Which files are affected: expected files include `src/modules/devices/routes.ts`, `src/modules/devices/schemas.ts`, `src/modules/devices/service.ts`, and `src/modules/devices/repository.ts`.
   - Expected outcome / how to verify: an owned device can send a heartbeat that updates `last_seen_at` and fresh metadata, while a foreign or nonexistent `deviceId` is rejected safely and does not leak another user's device record.
   - Potential risks: if heartbeat can mutate installation identity or ownership, the route becomes an unintended re-registration path instead of a lightweight presence update.

8. Implement `GET /v1/devices` with cursor pagination and safe ownership filtering.
   - What to do: add the authenticated device-list route, filter strictly by the current user, order results deterministically for cursor pagination, and return only safe management fields needed by the client.
   - Which files are affected: expected files include `src/modules/devices/routes.ts`, `src/modules/devices/schemas.ts`, `src/modules/devices/service.ts`, `src/modules/devices/repository.ts`, and `src/lib/pagination.ts` only if a new cursor shape helper is needed.
   - Expected outcome / how to verify: `GET /v1/devices?limit=...&cursor=...` returns `items` and `next_cursor`, includes only the caller's devices, and paginates stably across multiple rows.
   - Potential risks: missing stable ordering will produce duplicate or skipped rows across pages; missing ownership filtering will leak another user's installations.

9. Implement `DELETE /v1/devices/:deviceId` and define session cleanup behavior explicitly.
   - What to do: add the authenticated device-delete route, require ownership, revoke any active sessions anchored to that device before removing the device row, and ensure the deletion frees a slot under the max-active-device limit.
   - Which files are affected: expected files include `src/modules/devices/routes.ts`, `src/modules/devices/service.ts`, `src/modules/devices/repository.ts`, and `src/modules/auth/repository.ts` or `src/modules/auth/service.ts` if session revocation helpers are reused.
   - Expected outcome / how to verify: deleting an owned device removes it from future `GET /v1/devices` responses, invalidates its linked active sessions, and allows a new device to be registered without exceeding the user cap.
   - Potential risks: deleting the device row without revoking linked sessions can leave orphaned active auth sessions that still operate after the device appears removed in the UI.

10. Implement `GET /v1/preferences` and `PUT /v1/preferences` as a per-user synced default set.
   - What to do: add a preferences service and routes for the singleton `user_preferences` record. `GET /v1/preferences` should return a complete response even when no row exists yet by applying the server's default preference values, and `PUT /v1/preferences` should upsert the row for the authenticated user.
   - Which files are affected: expected files include new `src/modules/preferences/routes.ts`, `src/modules/preferences/service.ts`, `src/modules/preferences/repository.ts`, `src/modules/preferences/schemas.ts`, `src/app.ts`, and `prisma/schema.prisma` only if defaults are refined during implementation.
   - Expected outcome / how to verify: a new user can read defaults before any write, `PUT /v1/preferences` persists the four locked Phase 2 fields, and a second device on the same account reads the same updated values immediately.
   - Potential risks: forcing a pre-created row on first read complicates the API unnecessarily; failing to return defaults makes the client branch on missing data instead of one stable contract.

11. Implement dictionary list and create endpoints.
   - What to do: add `GET /v1/dictionary` and `POST /v1/dictionary`, scope records by the authenticated user plus current organization, paginate the list route, and validate phrase input strictly enough to reject empty or oversized entries.
   - Which files are affected: expected files include `src/modules/preferences/routes.ts`, `src/modules/preferences/service.ts`, `src/modules/preferences/repository.ts`, and `src/modules/preferences/schemas.ts`.
   - Expected outcome / how to verify: a user can create dictionary entries tied to the current organization, list them through `items` plus `next_cursor`, and the same account on a second device sees the same entries.
   - Potential risks: storing dictionary entries without organization scope now will make future multi-workspace behavior inconsistent; missing pagination breaks the locked API contract.

12. Implement dictionary update and delete endpoints.
   - What to do: add `PATCH /v1/dictionary/:entryId` and `DELETE /v1/dictionary/:entryId`, enforce ownership through the authenticated user plus current organization, and keep not-found versus foreign-resource handling consistent with the rest of the API.
   - Which files are affected: expected files include `src/modules/preferences/routes.ts`, `src/modules/preferences/service.ts`, `src/modules/preferences/repository.ts`, and `src/modules/preferences/schemas.ts`.
   - Expected outcome / how to verify: a user can update or delete only their own current-organization dictionary entries, and changes are reflected correctly in follow-up list calls from multiple devices on the same account.
   - Potential risks: weak ownership filtering will let one user mutate another user's dictionary state if IDs are guessed.

13. Implement writing-profile list, create, and patch endpoints.
   - What to do: add `GET /v1/writing-profiles`, `POST /v1/writing-profiles`, and `PATCH /v1/writing-profiles/:profileId`, validate `name`, `tone`, and `rules_json`, and scope every read and write to the authenticated user plus current organization.
   - Which files are affected: expected files include `src/modules/preferences/routes.ts`, `src/modules/preferences/service.ts`, `src/modules/preferences/repository.ts`, and `src/modules/preferences/schemas.ts`.
   - Expected outcome / how to verify: writing profiles can be created, updated, and listed through the shared pagination contract, and the same profiles appear consistently across two devices on the same account.
   - Potential risks: if `rules_json` is not validated as a bounded object, malformed or oversized profile payloads can become hard-to-debug sync issues.

14. Implement app-profile list and upsert endpoints with writing-profile ownership validation.
   - What to do: add `GET /v1/app-profiles` and `PUT /v1/app-profiles/:appKey`, store one app profile per user plus organization plus `app_key`, validate `settings_json`, and if `writing_profile_id` is provided, confirm that the referenced writing profile belongs to the same authenticated user and current organization before the upsert succeeds.
   - Which files are affected: expected files include `src/modules/preferences/routes.ts`, `src/modules/preferences/service.ts`, `src/modules/preferences/repository.ts`, and `src/modules/preferences/schemas.ts`.
   - Expected outcome / how to verify: `PUT` upserts one stable app-profile row per `appKey`, `GET` returns a paginated list with `items` and `next_cursor`, and foreign or mismatched `writing_profile_id` values are rejected safely.
   - Potential risks: without the ownership check on `writing_profile_id`, one profile could incorrectly point at another user's writing profile and break isolation.

15. Register the new modules and add automated coverage for the full Phase 2 contract.
   - What to do: register the finished `devices` and `preferences` modules in `src/app.ts`, update the test reset helper so the new tables are truncated between tests, add integration coverage for device registration, idempotency, device cap enforcement, heartbeat, deletion, preferences sync, dictionary CRUD, writing-profile CRUD, app-profile upsert, pagination, and cross-account ownership checks, then rerun the full project build and test suite.
   - Which files are affected: `src/app.ts`, `test/helpers/db.ts`, `test/helpers/app.ts` if new helpers are needed, and expected new tests such as `test/integration/devices.test.ts` and `test/integration/preferences.test.ts`.
   - Expected outcome / how to verify: all new Phase 2 routes are reachable through the app, the Phase 2 integration suite passes against `typetalk_test`, and the full existing Phase 1 suite still passes after the device-module refactor.
   - Potential risks: if the reset helper misses new tables, tests will become order-dependent; if only new tests are run, Phase 2 may silently break Phase 1 auth flows.

### Testing Strategy

- Run schema and migration verification first:
  - `npx prisma validate`
  - `npx prisma generate`
  - `npx prisma migrate dev`
  - apply the Phase 2 migration path to `typetalk_test`
- Run the full automated suite against `typetalk_test`, including all existing Phase 1 tests plus new integration tests for:
  - Phase 1 auth still provisioning devices correctly after device-logic extraction
  - `POST /v1/devices/register` happy path
  - `POST /v1/devices/register` repeated with the same idempotency key and same payload returning the stored response
  - `POST /v1/devices/register` repeated with the same idempotency key and a different payload returning a conflict
  - device-cap enforcement at the configured max active devices
  - `PATCH /v1/devices/:deviceId/heartbeat` updating `last_seen_at` and mutable metadata
  - `GET /v1/devices` pagination with `limit`, `cursor`, `items`, and `next_cursor`
  - `DELETE /v1/devices/:deviceId` removing the device and revoking its active sessions
  - `GET /v1/preferences` returning stable defaults before the first write
  - `PUT /v1/preferences` upserting synced preferences correctly
  - two different devices on the same account reading the same preferences after an update
  - `GET /v1/dictionary` pagination and `POST /v1/dictionary` creation
  - `PATCH /v1/dictionary/:entryId` and `DELETE /v1/dictionary/:entryId`
  - `GET /v1/writing-profiles`, `POST /v1/writing-profiles`, and `PATCH /v1/writing-profiles/:profileId`
  - `GET /v1/app-profiles` pagination and `PUT /v1/app-profiles/:appKey` upsert behavior
  - rejection of foreign `writing_profile_id` values when upserting app profiles
  - cross-account or cross-organization ownership checks for devices and preference/profile records
  - standard error-shape behavior for validation errors, conflicts, and not-found ownership cases
- Run manual or scripted API smoke checks for representative Phase 2 routes:
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
- Confirm Phase 2 API-contract details explicitly:
  - collection endpoints accept `limit` and `cursor`
  - collection responses return `items` and `next_cursor`
  - device registration replays safely under retry
  - the same authenticated account sees the same synced preferences, dictionary entries, writing profiles, and app profiles from two different devices
  - no Phase 2 route stores raw transcript text, raw prompt text, or any invasive device fingerprint data

### Success Criteria

- Prisma schema and migration exist for all locked Phase 2 tables: `user_preferences`, `dictionary_entries`, `writing_profiles`, `app_profiles`, and `idempotency_keys`.
- The existing Phase 1 auth flow still provisions devices correctly after device logic is extracted into a dedicated devices module.
- `POST /v1/devices/register`, `PATCH /v1/devices/:deviceId/heartbeat`, `GET /v1/devices`, and `DELETE /v1/devices/:deviceId` are implemented and verified.
- Device registration is idempotent: repeating the same request with the same idempotency key does not create duplicate device state, and reusing the same key with a different payload returns a conflict.
- Device ownership and active-device-cap enforcement are preserved, and deleting a device revokes its linked active sessions.
- `GET /v1/preferences` and `PUT /v1/preferences` are implemented and verified, and a user can read stable defaults before any write.
- `GET /v1/dictionary`, `POST /v1/dictionary`, `PATCH /v1/dictionary/:entryId`, and `DELETE /v1/dictionary/:entryId` are implemented and verified with proper user-plus-organization scoping.
- `GET /v1/writing-profiles`, `POST /v1/writing-profiles`, and `PATCH /v1/writing-profiles/:profileId` are implemented and verified with bounded `rules_json` validation.
- `GET /v1/app-profiles` and `PUT /v1/app-profiles/:appKey` are implemented and verified, with one stable app-profile row per user plus organization plus `app_key`.
- Collection endpoints in Phase 2 use the shared cursor-pagination contract: `GET /v1/devices`, `GET /v1/dictionary`, `GET /v1/writing-profiles`, and `GET /v1/app-profiles` all accept `limit` and `cursor` and return `items` plus `next_cursor`.
- Two authenticated devices on the same account can read the same preferences, dictionary entries, writing profiles, and app profiles.
- Cross-account and cross-organization ownership checks prevent one user from reading or mutating another user's device or synced profile data.
- The full automated suite, including existing Phase 1 coverage and new Phase 2 coverage, passes against `typetalk_test`.
