## Phase 4 Execution Review — Round 1
### Overall Assessment
I re-read the locked source plan, the approved Phase 4 plan, and the executor report, then verified the actual implementation in the Phase 4 billing, RTDN, migration, seed, retry-job, and test files. I also reran `npx prisma validate`, `npx prisma generate`, `npx prisma migrate status`, test-DB `npx prisma migrate deploy`, `npx prisma db seed`, `npx vitest run test/integration/billing.google-play.test.ts test/integration/billing.google-rtdn.test.ts`, `npm run build`, `npm run test`, and `npm run billing:webhooks:retry`; they all passed, so earlier phases still work in this workspace.

Most of the Phase 4 implementation is real: the schema, migration, seeded Google plan catalog, Google route surface, unified entitlement/invoice wiring, durable `purchase_tokens`, RTDN receipt, and retry-job extension all exist. I am not approving the phase because the Google RTDN route still mishandles malformed payloads and the new RTDN test path does not actually verify the real Pub/Sub envelope contract the live provider expects.

### Verified Claims
Step 1: VERIFIED — I re-read `final_plan.md`, `project_status.md`, `phase_3/exec_report.md`, and `phase_4/plan_approved.md`, then confirmed the claimed extension points in `prisma/schema.prisma`, `prisma/seed.ts`, `src/config/env.ts`, `src/app.ts`, `src/modules/billing/*`, `src/modules/entitlements/service.ts`, `src/jobs/webhook-retry.ts`, and `test/helpers/app.ts`. The current baseline still builds and the full suite still passes.

Step 2: VERIFIED — Google Play config parsing and provider injection are present in `src/config/env.ts`, `src/app.ts`, `package.json`, `.env.example`, and `test/helpers/app.ts`. The app compiles with `google-auth-library`, and the test harness injects a deterministic Google provider stub.

Step 3: VERIFIED — `prisma/schema.prisma` contains `PurchaseAcknowledgmentStatus` and the `purchase_tokens` table model with durable token identity, linked-token storage, acknowledgment state, retry metadata, and indexes.

Step 4: VERIFIED — the Phase 4 migration exists at `prisma/migrations/20260326051546_phase4_google_play_billing/migration.sql`, and `npx prisma migrate status` plus test-DB `npx prisma migrate deploy` both succeeded.

Step 5: VERIFIED — `prisma/seed.ts` now seeds non-null Google identifiers for `pro_monthly` and `pro_yearly`, and `npx prisma db seed` succeeded.

Step 6: VERIFIED — the Google provider abstraction exists in `src/modules/billing/provider.ts`, the live implementation exists in `src/modules/billing/google-play.ts`, and the stub provider exists in `test/helpers/app.ts`.

Step 7: VERIFIED — `src/modules/billing/repository.ts` now has DB-backed Google plan lookup, purchase-token persistence, acknowledgment retry helpers, and Google invoice-list reads.

Step 8: VERIFIED — `src/modules/billing/schemas.ts` and `src/modules/billing/routes.ts` define the new Google verify, restore, and RTDN route contracts, and the routes are registered through the shared app bootstrap.

Step 9: VERIFIED — `src/modules/billing/google-play-support.ts` implements actor-scoped idempotent verify with provider-state validation, DB-backed plan resolution, organization binding, durable token writes, and replay-safe responses. The targeted Google billing suite passed the happy path, replay, conflict, and pending-state cases.

Step 10: VERIFIED — initial acknowledgment and durable retry state are implemented in `src/modules/billing/google-play-support.ts` and `src/modules/billing/repository.ts`. I verified the forced-ack-failure flow in the targeted suite and the retry job path.

Step 11: VERIFIED — restore is implemented through the same shared sync path as verify in `src/modules/billing/google-play-support.ts`, exposed in `src/modules/billing/service.ts`, and routed in `src/modules/billing/routes.ts`. The targeted suite passed for restore success and idempotent replay.

Step 12: VERIFIED — Google provider state is mapped into shared `subscriptions`, `provider_customers`, `purchase_tokens`, and entitlements. Pending purchases remain non-entitling, and linked-token upgrades reuse one coherent subscription row.

Step 13: VERIFIED — unified billing reads are Google-aware. `GET /v1/billing/subscription`, `GET /v1/entitlements/current`, and `GET /v1/billing/invoices` all work under the Google-backed scenarios covered by the targeted suite, and the full `npm run test` run confirmed Phase 3 Stripe paths still pass.

Step 14: PARTIALLY_VERIFIED — trusted and invalid-token RTDN paths work, but malformed RTDN payload handling is wrong. I replayed `POST /v1/webhooks/google-play/rtdn` against the app harness with `content-type: application/json`, a valid bearer token, and payload `{not-json`; the route returned `500 internal_error` instead of a safe `400 invalid_google_rtdn_payload`.

Step 15: VERIFIED — the durable RTDN insert/dedupe pipeline is present. The targeted RTDN suite proved minimal payload storage, Pub/Sub `messageId` dedupe, distinct-message processing for the same purchase token, failed-row retryability, and stale-lock recovery.

Step 16: VERIFIED — `src/jobs/webhook-retry.ts` and `src/modules/billing/service.ts` now combine webhook-event retries with Google acknowledgment retries. `npm run billing:webhooks:retry` succeeded, and the targeted suites exercised both failed-row and stale-processing recovery.

Step 17: PARTIALLY_VERIFIED — the full command matrix passed exactly as claimed, but the RTDN verification path is not fully proven. The current test helper only keys off `messageId`, so the suite does not exercise the live provider’s required Pub/Sub `message.data` base64 decoding path.

### Issues Found
- [HIGH] Malformed Google RTDN envelopes still return `500` instead of a safe client error — `src/modules/billing/google-play.ts:157-175`, `src/modules/billing/google-play.ts:211-225`, `src/modules/billing/routes.ts:157-170` — The live provider does raw `JSON.parse` on the RTDN envelope and decoded payload without converting `SyntaxError` or decode failures into `AppError(400, "invalid_google_rtdn_payload", ...)`. I reproduced this through the actual route using the app harness: a malformed JSON body with a valid bearer token returned `500 internal_error`; after resetting the DB, the request wrote no Google webhook rows, so this is an error-classification bug rather than a state-corruption bug. This still violates the approved Phase 4 contract that malformed RTDN envelopes must be rejected safely. Fix by catching envelope JSON parse failures, base64 decode failures, and decoded-payload parse failures inside the provider and normalizing all of them to the existing invalid-RTDN `AppError`. Verify by replaying malformed outer JSON, malformed `message.data`, and malformed decoded JSON and asserting `400 invalid_google_rtdn_payload` with zero durable Google webhook writes.
- [MEDIUM] The RTDN integration suite does not verify the real Pub/Sub payload contract used by production — `test/helpers/app.ts:173-200`, `test/integration/billing.google-rtdn.test.ts:109-115`, `test/integration/billing.google-rtdn.test.ts:117-433` — The stub provider only parses `message.messageId` and returns a preloaded `GooglePlayRtdnEvent`, while the live provider requires `message.data` containing base64-encoded JSON with `subscriptionNotification.purchaseToken`. That means Step 14 and Step 17 overstate what is actually verified, and it is exactly why the malformed-envelope 500 bug shipped. Fix by either making the stub parse the same envelope and inner payload shape as production or by adding direct tests around `LiveGooglePlayProvider.verifyRtdn` with a stubbed OIDC verifier. Verify by sending a real RTDN-shaped payload with valid base64 data, invalid base64 data, invalid decoded JSON, and missing purchase token.

### Verdict
VERDICT: NEEDS_REVISION
