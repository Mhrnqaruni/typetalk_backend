## Phase 9 — Execution Report

### Fixes Applied — Review Round 2

- Issue: the inspector reported that the full backend verification matrix was no longer green and that the report was overstating the current local state. Current verification: that failure does not reproduce on the current workspace. The repo-side Phase 9 auth and test fixes already present in `src/app.ts`, `src/modules/auth/routes.ts`, `src/modules/auth/service.ts`, `src/modules/auth/web-routes.ts`, `test/integration/auth.email.test.ts`, and `test/integration/auth.web-email.test.ts` now rerun cleanly. What I fixed: no new backend application-code change was required in this review round because the current workspace already contains the repaired Phase 9 auth and test code; I reran the full backend matrix and refreshed this report to match the real result. How I verified: `npx prisma validate` passed, backend `npm run build` passed, and backend `npm run test` passed with `26/26` files and `110/110` tests.
- Issue: the inspector reported that the reachable deployed frontend origin could not honestly prove real browser auth because the production backend rejects `https://project-y32ng.vercel.app`. Confirmed for the production pairing, but the reachable rehearsal alias is now a preview deployment that ships the staging backend, not the production backend. What I fixed: tightened `../frontend/tests/auth.deployed.spec.js` so the real deployed smoke now asserts the live backend host, `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`, and the non-production debug OTP header instead of only checking that OTP login succeeds. How I verified: `curl.exe -i -X POST https://melodious-presence-staging.up.railway.app/v1/web-auth/refresh -H "Origin: https://project-y32ng.vercel.app"` returned `401` with `Access-Control-Allow-Origin: https://project-y32ng.vercel.app` and `Access-Control-Allow-Credentials: true`; the same probe against `https://melodious-presence-production-2a7d.up.railway.app` returned `403`; `vercel inspect project-y32ng.vercel.app` reports `target preview`; the deployed bundle still contains `https://melodious-presence-staging.up.railway.app`; and the stricter `npm run test:e2e:deployed` passed `3/3`.
- Issue: the inspector reported that real deployed Google web auth is still unprovisioned. Confirmed. What I fixed: there is no repo-side code change that can create the missing real Google web OAuth client; I kept the phase incomplete, preserved the fail-closed placeholder path, and refreshed the report so it no longer implies production Google readiness. How I verified: `railway variables --json -e production -s melodious-presence` still reports `GOOGLE_WEB_CLIENT_ID="replace_me"`, staging Railway still reports `GOOGLE_WEB_CLIENT_ID="replace_me"`, pulled Vercel production env still reports `VITE_GOOGLE_CLIENT_ID="replace_me"`, and the real deployed smoke still shows the placeholder Google message on `/login`.
- Issue: the inspector reported that the existing local browser smoke is mocked and therefore cannot count as end-to-end backend proof. Confirmed: `../frontend/tests/auth.smoke.spec.js` still uses `page.route(...)` and remains a fast local frontend regression suite only. What I fixed: kept the mocked local smoke for fast UI regression coverage and strengthened the non-mocked deployed smoke so Phase 9 now has explicit real-browser proof of the live preview-to-staging auth path. How I verified: frontend `npm run test:e2e` passed with `2 passed, 4 skipped`, and frontend `npm run test:e2e:deployed` passed with `3/3` against `https://project-y32ng.vercel.app` while asserting the live staging backend and CORS headers.

### Fixes Applied — Review Round 1

- Issue: the inspector reported that the full backend verification matrix was no longer green and that the report overstated the current backend state. Confirmed: the previous report was stale relative to the then-pending browser-auth rehearsal changes. What I fixed: I finished the non-production debug OTP header path for `/v1/auth/email/request-code`, `/v1/auth/email/resend-code`, `/v1/web-auth/email/request-code`, and `/v1/web-auth/email/resend-code`, exposed the header through backend CORS, and corrected the Phase 9 auth tests so the rehearsal path no longer broke the durable throttle assertions. How I verified: `npx prisma validate` passed, the focused auth suite passed, and backend `npm run test` passed with `26/26` files and `110/110` tests.
- Issue: the inspector reported that the reachable deployed frontend/backend pairing could not honestly validate real browser auth. Confirmed: the canonical same-site domains `typetalk.app` and `api.typetalk.app` still do not resolve, and the preview-domain rehearsal pair is cross-site. What I fixed: I kept the reachable rehearsal frontend on `https://project-y32ng.vercel.app`, verified that its deployed bundle points at `https://melodious-presence-staging.up.railway.app`, deployed the current backend rehearsal build to Railway staging as deployment `a64517bd-c95d-4911-9ee4-e98210fcb060`, and documented the cross-site `SameSite=Lax` limitation in `runbooks/production.md` and `../frontend/deploy.md`. How I verified: staging `POST /v1/web-auth/email/request-code` returned `202`, `x-typetalk-debug-otp-code`, `Access-Control-Allow-Origin: https://project-y32ng.vercel.app`, and `Access-Control-Allow-Credentials: true`; the real deployed Playwright smoke proved redirect, OTP login, and logout against the live staging pair.
- Issue: the inspector reported that real deployed Google web auth was still unprovisioned. Confirmed: this remains true and is not fixable from repository code alone. What I fixed: I kept the frontend fail-closed placeholder behavior, preserved the separate native-versus-web Google audience path, and updated the report so Phase 9 no longer overclaims deployed Google readiness. How I verified: `railway variables --json -e production -s melodious-presence` shows `GOOGLE_WEB_CLIENT_ID=\"replace_me\"`, pulled Vercel production env shows `VITE_GOOGLE_CLIENT_ID=\"replace_me\"`, and the real deployed smoke shows the placeholder Google message on `/login`.
- Issue: the inspector reported that the browser smoke was still mocked through `page.route(...)` and therefore did not prove real cookies or backend auth. Confirmed. What I fixed: I updated `../frontend/tests/auth.deployed.spec.js` to consume the live non-production `x-typetalk-debug-otp-code` response header directly from the deployed backend instead of relying on stubbed `/v1/web-auth/*` routes or manual log scraping. How I verified: `npm run test:e2e:deployed` passed `3/3` against `https://project-y32ng.vercel.app` with no auth-route stubs.

### Summary

Phase 9 delivered the browser-auth code path for TypeTalk and the current local matrix is green again end to end. The backend exposes dedicated `/v1/web-auth/*` routes, the frontend has `/login` plus protected `/app/*` routes and auth bootstrap, and the review-round rehearsal path now includes a stricter non-mocked deployed smoke that asserts the live backend host, CORS headers, and debug OTP header for the reachable preview-to-staging pair. The current verification matrix passes: backend `npx prisma validate`, backend `npm run build`, backend `npm run test` (`26/26` files, `110/110` tests), frontend `npm run build`, frontend `npm run test` (`5/5` files, `11/11` tests), frontend `npm run test:e2e` (`2 passed`, `4 skipped`), and frontend `npm run test:e2e:deployed` (`3/3`).

The phase is still not complete. The reachable rehearsal domains are currently `project-y32ng.vercel.app` and `melodious-presence-staging.up.railway.app`, which are cross-site, so they can prove redirect, OTP login, logout, and the staging CORS contract, but they still cannot prove `SameSite=Lax` refresh-cookie persistence on reload; the real deployed smoke therefore still expects reload to return to `/login`. Real browser Google sign-in also remains blocked because Railway production and staging still have `GOOGLE_WEB_CLIENT_ID=replace_me`, and Vercel production still has `VITE_GOOGLE_CLIENT_ID=\"replace_me\"`.

### Step-by-Step Execution Log

- Step 1: Freeze the browser-auth contract and route split
  - Action taken: Recorded the locked Phase 9 browser-auth contract in `runbooks/production.md` and `../frontend/deploy.md`, then extended both docs during review to state explicitly that preview-domain rehearsal is cross-site and cannot prove `SameSite=Lax` reload persistence.
  - Files modified:
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\runbooks\production.md` — froze the browser-auth contract and added the preview-domain cookie-persistence limitation.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\deploy.md` — froze the frontend contract and added the same-site-domain requirement for real reload persistence.
  - Verification: Read both files back after editing and confirmed the route split, `HttpOnly` cookie ownership, no-`localStorage` rule, and cross-site preview limitation are now explicit.
  - Status: DONE

- Step 2: Add backend web-auth env and cookie primitives
  - Action taken: Added `@fastify/cookie`, introduced `GOOGLE_WEB_CLIENT_ID` and `WEB_AUTH_REFRESH_COOKIE_NAME`, extended backend config parsing, split native-versus-web Google audience handling, and created shared web-session helpers for reading, writing, and clearing the refresh cookie.
  - Files modified:
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\package.json` — added the cookie dependency and retained the Phase 9 scripts.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\package-lock.json` — updated lockfile.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\.env.example` — documented the web-auth env keys.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\.env.local` — added local web-auth config.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\.env.test` — added test web-auth config.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\config\env.ts` — parsed the new web-auth config.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\modules\auth\google.ts` — split native and web Google audiences.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\modules\auth\web-session.ts` — centralized browser refresh-cookie handling.
  - Verification: Backend build and auth integration coverage passed, and the live production env dump still shows the expected Phase 9 keys, including `GOOGLE_WEB_CLIENT_ID`.
  - Status: DONE

- Step 3: Add dedicated backend web-auth endpoints without regressing native auth
  - Action taken: Added `/v1/web-auth/*`, kept native `/v1/auth/*` unchanged, made browser verify or Google sign-in return only access-token/session payload while writing the refresh cookie server-side, and during review added the non-production debug OTP header path so deployed rehearsal can read the OTP without stubbing or manual log scraping.
  - Files modified:
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\app.ts` — registers cookie parsing and exposes `x-typetalk-debug-otp-code`.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\modules\auth\routes.ts` — native request and resend now emit the debug header in non-production log mode.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\modules\auth\service.ts` — returns `debugOtpCode` for eligible request and resend flows.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\modules\auth\web-routes.ts` — browser request and resend now emit the debug header and keep refresh-cookie behavior server-side.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\test\helpers\app.ts` — keeps the verifier harness aligned with native and web audience handling.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\test\integration\auth.email.test.ts` — asserts the native debug OTP header.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\test\integration\auth.web-email.test.ts` — asserts the browser debug OTP header and the durable throttle behavior.
  - Verification: Focused auth tests passed, backend `npm run test` passed, staging Railway deployment `a64517bd-c95d-4911-9ee4-e98210fcb060` succeeded, and live staging request-code returned `202` with `x-typetalk-debug-otp-code`.
  - Status: DONE

- Step 4: Enforce credential-aware CORS and cookie-bearing request origin checks
  - Action taken: Kept exact-origin enforcement, required trusted `Origin` or `Referer` on cookie-bearing `/v1/web-auth/*` routes, and preserved the Phase 8 no-wildcard policy. During review I verified the live rehearsal pair instead of widening policy for preview convenience.
  - Files modified:
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\app.ts` — credential-aware CORS with explicit exposed headers.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\modules\auth\web-routes.ts` — trusted-origin enforcement on cookie-bearing routes.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\test\lib\origin-policy.test.ts` — locks allowed and blocked origin behavior.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\test\integration\auth.web-email.test.ts` — missing-origin rejection coverage.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\test\integration\auth.web-refresh.test.ts` — allowed, blocked, missing-origin, and missing-cookie coverage.
  - Verification: Local origin tests passed; `curl.exe -i -X POST https://melodious-presence-staging.up.railway.app/v1/web-auth/refresh -H "Origin: https://project-y32ng.vercel.app"` returned `401` with `Access-Control-Allow-Origin: https://project-y32ng.vercel.app` and `Access-Control-Allow-Credentials: true`; the same probe against `https://melodious-presence-production-2a7d.up.railway.app` returned `403`; preview-domain reload persistence is still blocked by the locked `SameSite=Lax` cookie policy plus cross-site rehearsal domains, not by missing CORS enforcement.
  - Status: DONE_WITH_DEVIATION

- Step 5: Add frontend app infrastructure and protected route namespace
  - Action taken: Rebuilt the frontend route tree around public marketing routes, `/login`, and protected `/app/*`; added shared auth utilities, auth context, the protected-route component, and the app shell.
  - Files modified:
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\App.jsx` — split public and protected routes.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\lib\api.js` — shared API helper and `ApiError`.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\lib\auth.js` — browser-auth API client.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\context\AuthContext.jsx` — in-memory auth state and bootstrap logic.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\components\ProtectedRoute.jsx` — protected-route gate.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\components\AppShell.jsx` — authenticated shell.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\components\AppShell.css` — app-shell styles.
  - Verification: Frontend `npm run build` passed, and the deployed Vercel alias returns `200` for both `/login` and `/app/account`.
  - Status: DONE

- Step 6: Implement frontend bootstrap, refresh, and logout flow
  - Action taken: Implemented one-shot refresh bootstrap, in-memory-only access-token storage, credentialed browser-auth requests, and logout cleanup. During review I verified the current live cross-site behavior instead of assuming same-site persistence.
  - Files modified:
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\context\AuthContext.jsx` — bootstrap, logout, and 401 clearing.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\lib\auth.js` — credentialed verify, Google, refresh, and logout requests.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\components\ProtectedRoute.jsx` — waits for bootstrap before redirecting.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\tests\auth.deployed.spec.js` — real deployed smoke for current reload behavior.
  - Verification: Local unit coverage passed and local behavior still restores the session, but the real deployed rehearsal pair currently redirects to `/login?next=%2Fapp%2Fusage` after reload because `project-y32ng.vercel.app` and `melodious-presence-staging.up.railway.app` are cross-site under a locked `SameSite=Lax` cookie policy.
  - Status: DONE_WITH_DEVIATION

- Step 7: Build email OTP login for browser users
  - Action taken: Added the OTP login UI with request, resend, verify, error handling, and post-login redirect, then used the review-round debug OTP header path to prove the real deployed login flow without mocking.
  - Files modified:
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\pages\Login.jsx` — browser OTP login UI.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\pages\Login.css` — login styles.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\tests\auth.deployed.spec.js` — real deployed OTP login proof.
  - Verification: Real deployed Playwright smoke reached `/app/usage` on `https://project-y32ng.vercel.app`, using a live `POST /v1/web-auth/email/request-code` response from Railway staging and the returned debug OTP header, then logged out cleanly.
  - Status: DONE

- Step 8: Build browser Google sign-in on the dedicated web-auth path
  - Action taken: Preserved the separate backend native-versus-web Google audience path and frontend Google client handling, while keeping the browser UI fail-closed when the web client id is placeholder data.
  - Files modified:
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\modules\auth\google.ts` — dedicated web audience verification.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\modules\auth\service.ts` — `audience: "web"` support.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\test\integration\auth.google.test.ts` — native Google non-regression.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\test\integration\auth.web-google.test.ts` — browser Google flow coverage.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\lib\google.js` — placeholder-aware Google client handling.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\lib\google.test.js` — placeholder-versus-real client tests.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\components\GoogleSignInButton.jsx` — browser Google button wiring.
  - Verification: Local backend coverage passed for native and web Google audiences, the real deployed smoke shows the placeholder Google message, Railway production still has `GOOGLE_WEB_CLIENT_ID="replace_me"`, and pulled Vercel production env still has `VITE_GOOGLE_CLIENT_ID="replace_me"`.
  - Status: DONE_WITH_DEVIATION

- Step 9: Build the logged-in app shell and protected placeholder routes
  - Action taken: Added the authenticated shell, logout control, app home, and protected placeholders for `/app/account`, `/app/billing`, `/app/usage`, `/app/preferences`, and `/app/sessions`, while correcting the public branding to `TypeTalk`.
  - Files modified:
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\components\AppShell.jsx` — protected navigation and logout control.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\pages\AppHome.jsx` — authenticated landing page.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\pages\AppHome.css` — app-home styles.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\pages\AppPlaceholder.jsx` — protected placeholders.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\components\Header.jsx` — login and open-app CTA plus corrected brand text.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\components\Header.css` — auth CTA styles.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\components\Footer.jsx` — corrected brand copy.
  - Verification: The deployed Vercel alias returns `200` for `/login` and `/app/account`, and the real deployed smoke renders the `/app/usage` shell after OTP login.
  - Status: DONE

- Step 10: Add mandatory frontend auth test tooling
  - Action taken: Added Vitest plus Playwright tooling for frontend auth, kept the mocked local smoke for fast regression coverage, and during review upgraded `tests/auth.deployed.spec.js` into a real deployed smoke that hits the live backend. In Review Round 2 I tightened that deployed smoke further so it now asserts the live backend host, `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`, and the non-production debug OTP header instead of only exercising the happy path.
  - Files modified:
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\package.json` — frontend test scripts.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\package-lock.json` — updated lockfile.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\vite.config.js` — Vitest config.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\test\setup.js` — test setup.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\context\AuthContext.test.jsx` — auth bootstrap tests.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\components\ProtectedRoute.test.jsx` — route-guard tests.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\pages\Login.test.jsx` — OTP flow tests.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\lib\auth.test.js` — credentialed browser-auth request tests.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\lib\google.test.js` — placeholder Google handling tests.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\playwright.config.js` — deployed smoke config.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\tests\auth.smoke.spec.js` — fast mocked regression smoke.
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\tests\auth.deployed.spec.js` — real deployed rehearsal smoke.
  - Verification: Frontend `npm run test` passed `5/5` files and `11/11` tests, frontend `npm run test:e2e` passed with `2 passed` and `4 skipped`, and frontend `npm run test:e2e:deployed` passed `3/3` against the real deployed staging pair using no auth-route stubs while asserting the live staging backend and CORS headers.
  - Status: DONE_WITH_DEVIATION

- Step 11: Run full Phase 9 verification against local and deployed environments
  - Action taken: Reran the backend matrix, reran the frontend build, unit, and Playwright suites, executed the stricter real deployed smoke against the reachable rehearsal origin, refreshed Railway staging and production origin evidence, inspected the live Vercel rehearsal deployment, and refreshed the Railway and Vercel env evidence instead of relying on the old optimistic report.
  - Files modified:
    - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\phase_9\exec_report.md` — rewritten to match the real Round 1 state.
  - Verification:
    - Backend `npx prisma validate` passed.
    - Backend `npm run build` passed.
    - Backend `npm run test` passed with `26/26` files and `110/110` tests.
    - Frontend `npm run build` passed.
    - Frontend `npm run test` passed with `5/5` files and `11/11` tests.
    - Frontend `npm run test:e2e` passed with `2 passed` and `4 skipped`.
    - Real deployed smoke passed `3/3` with `PLAYWRIGHT_DEPLOYED_EXPECT_RELOAD_RESULT=login`, `PLAYWRIGHT_DEPLOYED_EXPECT_API_HOST=melodious-presence-staging.up.railway.app`, `PLAYWRIGHT_DEPLOYED_EXPECT_ALLOW_ORIGIN=https://project-y32ng.vercel.app`, and `PLAYWRIGHT_DEPLOYED_REQUIRE_DEBUG_OTP_HEADER=1`.
    - `vercel inspect project-y32ng.vercel.app` reports the reachable rehearsal deployment as `target preview`.
    - The reachable rehearsal bundle contains `https://melodious-presence-staging.up.railway.app`, not the Railway production URL.
    - `curl.exe -i -X POST https://melodious-presence-staging.up.railway.app/v1/web-auth/refresh -H "Origin: https://project-y32ng.vercel.app"` returned `401` with the expected credential CORS headers.
    - `curl.exe -i -X POST https://melodious-presence-production-2a7d.up.railway.app/v1/web-auth/refresh -H "Origin: https://project-y32ng.vercel.app"` returned `403`.
    - `Resolve-DnsName typetalk.app` and `Resolve-DnsName api.typetalk.app` both returned DNS name does not exist.
    - Railway production still reports `GOOGLE_WEB_CLIENT_ID=replace_me`.
    - Railway staging still reports `GOOGLE_WEB_CLIENT_ID=replace_me`.
    - Pulled Vercel production env still reports `VITE_API_BASE_URL=https://melodious-presence-production-2a7d.up.railway.app` and `VITE_GOOGLE_CLIENT_ID=replace_me`.
  - Status: DONE_WITH_DEVIATION

### Testing Results

```text
backend> npx prisma validate
Prisma schema loaded from prisma\schema.prisma
The schema at prisma\schema.prisma is valid 🚀
warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7.
Environment variables loaded from .env
```

```text
backend> npm run build
> typetalk-backend@0.1.0 build
> tsc -p tsconfig.json
```

```text
backend> npm run test
> typetalk-backend@0.1.0 test
> tsx scripts/ensure-test-db.ts && cross-env NODE_ENV=test vitest run

Test database already ready at 127.0.0.1:55432.
Test Files  26 passed (26)
Tests       110 passed (110)
```

```text
frontend> npm run build
> typeless-frontend@0.0.0 build
> vite build

✓ built in 8.95s
```

```text
frontend> npm run test
> typeless-frontend@0.0.0 test
> vitest run

Test Files  5 passed (5)
Tests       11 passed (11)
```

```text
frontend> npm run test:e2e
> typeless-frontend@0.0.0 test:e2e
> playwright test

Running 6 tests using 2 workers
- 3 deployed smoke tests skipped because PLAYWRIGHT_DEPLOYED_BASE_URL was not set
ok 1 tests\auth.smoke.spec.js:109:1 › redirects logged-out users away from protected routes
ok 2 tests\auth.smoke.spec.js:116:1 › completes otp login, survives reload bootstrap, and logs out cleanly
- 1 google sign-in smoke skipped because PLAYWRIGHT_ENABLE_GOOGLE_SMOKE was not set

2 passed
4 skipped
```

```text
frontend> npm run test:e2e:deployed
env:
  PLAYWRIGHT_DEPLOYED_BASE_URL=https://project-y32ng.vercel.app
  PLAYWRIGHT_DEPLOYED_EMAIL=phase9-round2-{scenario}-1774880600@example.com
  PLAYWRIGHT_DEPLOYED_EXPECT_RELOAD_RESULT=login
  PLAYWRIGHT_DEPLOYED_EXPECT_GOOGLE_PLACEHOLDER=1
  PLAYWRIGHT_DEPLOYED_EXPECT_API_HOST=melodious-presence-staging.up.railway.app
  PLAYWRIGHT_DEPLOYED_EXPECT_ALLOW_ORIGIN=https://project-y32ng.vercel.app
  PLAYWRIGHT_DEPLOYED_REQUIRE_DEBUG_OTP_HEADER=1

Running 3 tests using 1 worker
ok 1 tests\auth.deployed.spec.js:116:3 › deployed browser auth smoke › redirects, signs in with a real OTP, and logs out on the deployed site
ok 2 tests\auth.deployed.spec.js:136:3 › deployed browser auth smoke › matches the expected deployed reload behavior
ok 3 tests\auth.deployed.spec.js:164:3 › deployed browser auth smoke › shows the configured Google placeholder state on the deployed login page

3 passed
```

```text
live staging> POST /v1/web-auth/email/request-code
Status: 202
x-typetalk-debug-otp-code: 517201
Access-Control-Allow-Origin: https://project-y32ng.vercel.app
Access-Control-Allow-Credentials: true
```

```text
dns> Resolve-DnsName typetalk.app
Resolve-DnsName : typetalk.app : DNS name does not exist

dns> Resolve-DnsName api.typetalk.app
Resolve-DnsName : api.typetalk.app : DNS name does not exist
```

### Success Criteria Checklist

- [x] Dedicated backend web-auth routes exist under `/v1/web-auth/*` and native `/v1/auth/*` behavior remains backward compatible.
- [ ] Browser OTP and Google login both establish the secure refresh cookie successfully, and browser refresh does not store long-lived credentials in `localStorage` or `sessionStorage`.
- [x] Web OTP request and verify flows reuse the same durable per-IP limits, per-email issuance throttle, OTP lockout behavior, and relevant `security_events` coverage as native auth.
- [x] Credential-aware CORS and cookie-bearing origin validation are enforced for browser auth without widening production origins casually.
- [x] The frontend has a real auth-aware route tree with a protected `/app/*` namespace.
- [ ] Browser users can sign in with email OTP and with Google through the dedicated web-auth contract, and native Google auth still passes against its original audience.
- [ ] Page reload restores the session through the cookie-backed refresh path and logout clears it cleanly.
- [ ] Direct-load access to a protected route while logged out redirects to `/login`, and direct-load access while logged in restores and renders the app shell.
- [x] The logged-in app shell, logout control, and placeholder protected routes are present and ready for Phase 10 product-page wiring.
- [x] Frontend auth unit/integration tests exist and pass locally.
- [ ] Browser-level auth smoke coverage exists and passes for OTP login, reload bootstrap, and protected-route redirect, plus Google sign-in when the real web client dependency is available.
- [x] The phase is not marked complete if Google web auth or deployed browser-auth verification is still missing.

### Known Issues

- The canonical same-site domains `typetalk.app` and `api.typetalk.app` do not currently resolve, so the reachable deployed rehearsal pair remains cross-site (`project-y32ng.vercel.app` plus `melodious-presence-staging.up.railway.app`). Under the locked `SameSite=Lax` cookie policy, that pair cannot prove refresh-cookie persistence on reload.
- Railway production still has `GOOGLE_WEB_CLIENT_ID=replace_me`, and pulled Vercel production env still has `VITE_GOOGLE_CLIENT_ID=replace_me`, so real deployed browser Google sign-in is still unavailable.
- The reachable Vercel rehearsal alias is currently a preview deployment that ships the staging backend, while the linked Vercel production env still points `VITE_API_BASE_URL` at the Railway production backend. That production env is not the source of the current browser-auth rehearsal proof.
- Frontend unit tests still emit React Router v7 future-flag warnings.
- `npx prisma validate` still emits the existing Prisma deprecation warning for `package.json#prisma`.
