## Phase 8 — Implementation Plan

### Changes After Review Round 1

- Inspector comment: the plan required a deployed display-safe `GET /v1/billing/plans` result but never assigned the backend work needed to make the current endpoint display-safe. What I changed: added an explicit backend Step 3 that narrows the public plans response, updates billing contract tests, and verifies that provider/internal fields such as `paddle_price_id`, `stripe_price_id`, `google_product_id`, and `google_base_plan_id` are excluded. Why: the current backend still exposes those fields, so Phase 8 could not honestly pass without assigning that implementation work.
- Inspector comment: the backend env-file plan ignored the repo’s real `.env.local` and `.env.test` loading behavior. What I changed: expanded the backend env step to include `.env.local` and `.env.test` whenever env parsing or feature flags change, and added verification that local and test commands still run through the actual env files this repo already depends on. Why: `src/config/env.ts` loads `.env.local` for development and `.env.test` for tests, so changing only `.env.example` would leave the real runtime/test paths vulnerable to drift or breakage.
- Inspector comment: frontend-to-backend connectivity proof was too vague because the current frontend has no API client or health probe. What I changed: added an explicit Step 8 for a lightweight frontend-origin connectivity smoke path or equivalent scripted check served from the real Vercel origin, and made deployed verification require proof that `VITE_API_BASE_URL`, deployed CORS, and the live frontend origin can reach `/health` and `/v1/billing/plans`. Why: route-load checks alone are not enough to prove the deployed frontend can actually talk to the live backend.

### Objective

Make the backend and frontend deployable as real production services with explicit domain, environment, migration, rollback, CORS, SPA-routing, and frontend-origin connectivity behavior so later browser-auth and product-integration work happens on a verified deployment foundation instead of assumptions.

### Prerequisites

- Phases `0` through `7` are complete and the current backend baseline is green after Phase 7.
- The approved source of truth remains [extend-plan.md](C:\Users\User\Desktop\voice to clip\TypeTalk\backend\extend-plan.md), with [master_plan.md](C:\Users\User\Desktop\voice to clip\TypeTalk\backend\master_plan.md) as the governing phase roadmap.
- Pre-Phase-8 decisions from the master plan are frozen:
  - public product name is resolved
  - launch-platform scope is resolved
  - pricing and free-quota truth is confirmed
  - canonical production and staging URLs are confirmed
  - legal/support identity direction is confirmed enough to avoid deployment rework
- GitHub checkpoints for `backend/` and `frontend/` exist before deploy-related changes begin.
- Railway, Vercel, and DNS access exist for real deployment verification; if any are missing, local work may continue but the phase cannot be marked fully complete.

### Steps

1. Step 1: Record the frozen deployment inputs and Phase 8 boundary
   - What to do:
     - Capture the final Phase 8 inputs in deployment-facing docs before touching deploy config:
       - product name
       - canonical production URLs
       - staging URLs
       - launch-platform scope
       - confirmed pricing/free-quota baseline
       - support identity assumptions relevant to deploy-time env wiring
     - Explicitly note that live Paddle merchant activation stays deferred and is not part of Phase 8 completion.
     - Record the current known operational state from Phase 7, especially that Railway CLI resolves the project and environment but no service is currently selected.
   - Which files are affected:
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\runbooks\production.md` (new)
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\deploy.md` (new)
   - Expected outcome / how to verify:
     - There is one written deployment-input matrix in repo docs.
     - The docs explicitly say Phase 8 is deployment foundation only and does not include live Paddle enablement.
     - Verification is a read-through confirming there is no remaining ambiguity around name, URLs, platform scope, or pricing baseline.
   - Potential risks:
     - Starting deployment work while branding or domain choices are still unsettled.
     - Carrying incorrect platform promises into frontend deployment config and later public rollout.

2. Step 2: Audit and finalize the backend production environment inventory
   - What to do:
     - Audit `src/config/env.ts` against `.env.example` and the Phase 8 source plan.
     - Add or correct any missing documented env vars needed for deployable backend behavior, including:
       - database access
       - JWT/auth settings
       - origin allowlist
       - Paddle flags and secrets already used by the backend
       - Google Play config
       - email delivery config
       - security retention settings
       - Phase 8 billing feature flags such as `BILLING_CHECKOUT_ENABLED` and `BILLING_CUSTOMER_PORTAL_ENABLED`
     - Because this repo loads `.env.local` for development and `.env.test` for tests, update those files or provide safe defaults whenever the backend env schema changes.
     - Make sure `.env.example` documents deploy-relevant values without leaking secrets.
   - Which files are affected:
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\.env.example`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\.env.local`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\.env.test`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\config\env.ts`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\runbooks\production.md`
   - Expected outcome / how to verify:
     - Every required backend production variable is declared once in code and once in docs.
     - Local and test env files still satisfy the schema after any env additions.
     - `npm run build` and `npm run test` still pass through the real `.env.local` and `.env.test` loading paths.
   - Potential risks:
     - Drift between runtime env parsing and example/local/test env files.
     - Accidentally documenting secrets in committed files.

3. Step 3: Narrow the public billing plans contract to the display-safe shape
   - What to do:
     - Update the backend billing service, route contract, and tests so `GET /v1/billing/plans` returns only the display-safe fields locked by the extension plan:
       - `code`
       - `display_name`
       - `amount_cents`
       - `currency`
       - `billing_interval`
       - `weekly_word_limit`
       - `trial_days`
       - `is_active`
     - Remove provider/internal fields from the public response surface, including:
       - `paddle_price_id`
       - `stripe_price_id`
       - `google_product_id`
       - `google_base_plan_id`
       - any similar internal identifiers if currently exposed
     - Update billing integration or contract tests so the public contract is locked before deploy verification relies on it.
   - Which files are affected:
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\modules\billing\service.ts`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\modules\billing\routes.ts`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\modules\billing\schemas.ts`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\test\integration\billing*.test.ts`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\runbooks\production.md`
   - Expected outcome / how to verify:
     - Local billing tests prove `/v1/billing/plans` no longer exposes provider/internal fields.
     - Deployed Phase 8 verification can safely treat `/v1/billing/plans` as a public display-safe endpoint.
   - Potential risks:
     - Leaving internal provider identifiers exposed in a public contract.
     - Breaking existing tests or seeded-plan verification by changing the response shape without updating assertions.

4. Step 4: Create the frontend environment inventory and non-secret build contract
   - What to do:
     - Create `frontend/.env.example` because it does not exist yet.
     - Define the non-secret frontend env contract for production and staging, including:
       - `VITE_API_BASE_URL`
       - `VITE_PUBLIC_SITE_URL`
       - `VITE_SUPPORT_EMAIL`
       - `VITE_GOOGLE_CLIENT_ID`
       - `VITE_WINDOWS_DOWNLOAD_URL`
       - `VITE_GOOGLE_PLAY_URL`
       - `VITE_BILLING_CHECKOUT_ENABLED`
       - `VITE_BILLING_CUSTOMER_PORTAL_ENABLED`
     - Document which values are safe for Vercel build-time exposure and which must stay backend-only.
   - Which files are affected:
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\.env.example` (new)
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\package.json`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\vite.config.js`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\deploy.md`
   - Expected outcome / how to verify:
     - Frontend env documentation exists and uses only `VITE_`-prefixed public variables.
     - `npm run build` succeeds with non-secret placeholder/local values.
     - There is no attempt to push secrets into client-exposed env vars.
   - Potential risks:
     - Confusing backend secrets with frontend build vars.
     - Missing a required frontend variable and only discovering it after Vercel deploy.

5. Step 5: Lock the Railway backend deploy contract and database behavior
   - What to do:
     - Select or create the Railway `api` service explicitly instead of leaving CLI state at `Service: None`.
     - Confirm `postgres` attachment, private networking, and document the live backup-capability status without making it a Phase 8 gate.
     - Freeze the backend deploy contract:
       - bind to `0.0.0.0:$PORT`
       - use `GET /health` as the healthcheck
       - run `npx prisma migrate deploy` before app start
       - keep seed execution idempotent and decide whether it is one-time manual or part of first deploy runbook
     - Document the exact Railway commands/UI settings required to reproduce the deploy.
   - Which files are affected:
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\package.json`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\app.ts`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\config\env.ts`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\runbooks\production.md`
   - Expected outcome / how to verify:
     - Railway service selection is explicit and reproducible.
     - The backend no longer relies on implicit local assumptions for deploy behavior.
     - Verification includes checking Railway service state, private networking, documented backup-capability status, and a successful deployed `/health`.
   - Potential risks:
     - Running migrations against the wrong service or environment.
     - Startup failures caused by missing env vars or hidden deploy assumptions.

6. Step 6: Set the exact production and staging origin policy in the backend
   - What to do:
     - Freeze `ALLOWED_ORIGINS` for production to the exact Phase 8 allowlist:
       - `https://typetalk.app`
       - `https://www.typetalk.app`
     - Decide the staging origin policy explicitly if preview browser testing is required.
     - Make sure the backend remains ready for Phase 9 credentialed browser auth without prematurely widening production CORS.
     - Document the preview strategy so arbitrary `*.vercel.app` origins are not added casually to production.
   - Which files are affected:
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\config\env.ts`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\src\app.ts`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\.env.example`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\.env.local`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\.env.test`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\runbooks\production.md`
   - Expected outcome / how to verify:
     - Production CORS is exact, reviewable, and non-wildcard.
     - Allowed-origin and blocked-origin checks behave as expected.
     - The written staging strategy exists for future Phase 9 browser auth testing.
   - Potential risks:
     - Over-broad CORS in production.
     - Breaking future browser auth by leaving staging and preview behavior undefined.

7. Step 7: Add explicit Vercel SPA routing and frontend deployment wiring
   - What to do:
     - Create `frontend/vercel.json` because it is currently missing.
     - Add the explicit SPA rewrite to `/index.html`.
     - Confirm the frontend build contract:
       - build command `npm run build`
       - output directory `dist`
     - Document how preview versus production deploys will be handled.
   - Which files are affected:
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\vercel.json` (new)
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\package.json`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\vite.config.js`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\deploy.md`
   - Expected outcome / how to verify:
     - Deep SPA routes no longer depend on Vercel defaults.
     - `npm run build` and `npm run preview` pass locally.
     - Deployed direct loads of `/pricing`, `/downloads`, `/about`, and one non-root route succeed without 404.
   - Potential risks:
     - Misconfigured rewrites causing asset or route failures.
     - Preview and production behavior diverging unexpectedly.

8. Step 8: Add a frontend-origin connectivity smoke for deployed proof
   - What to do:
     - Add one explicit frontend connectivity-smoke mechanism so deployed Vercel pages can prove live backend connectivity from the real frontend origin.
     - Use one of these exact implementation patterns:
       - a lightweight internal route such as `/deploy-check` that fetches backend `/health` and `/v1/billing/plans`, or
       - an equivalent documented scripted/browser check that is served or run from the deployed frontend origin
     - Wire the smoke to `VITE_API_BASE_URL` so Phase 8 proves env usage, deployed CORS, and frontend-to-backend connectivity together.
     - Keep the check non-promoted and operational rather than turning it into a user-facing product feature.
   - Which files are affected:
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\App.jsx`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\src\pages\DeployCheck.jsx` (new) or equivalent scripted check file
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\deploy.md`
   - Expected outcome / how to verify:
     - The deployed frontend origin can make a real request to backend `/health` and `/v1/billing/plans`.
     - Phase 8 has explicit proof that `VITE_API_BASE_URL`, deployed frontend origin, and backend CORS all work together.
   - Potential risks:
     - Shipping route-load success while real backend connectivity is still broken.
     - Adding a noisy public surface instead of a focused operational check.

9. Step 9: Write the first production deploy order, seed policy, and rollback runbook
   - What to do:
     - Write the exact first-rollout sequence:
       1. backend GitHub checkpoint
       2. frontend GitHub checkpoint
       3. Railway `postgres` confirmation
       4. Railway `api` env setup
       5. backend deploy with `npx prisma migrate deploy`
       6. idempotent seed execution or seeded-plan verification
       7. backend endpoint verification
       8. Vercel env setup
       9. frontend deploy
       10. frontend route and connectivity verification
     - Document rollback rules for:
       - failed migration
       - code-only regression
       - schema mismatch
       - frontend/backend contract mismatch
   - Which files are affected:
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\runbooks\production.md`
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\frontend\deploy.md`
   - Expected outcome / how to verify:
     - The rollout order exists in writing before any real deploy starts.
     - A dry read-through of the runbook reveals no missing deploy or rollback step.
   - Potential risks:
     - Partial rollout with backend and frontend on mismatched contracts.
     - Ad hoc rollback during a failed production push.

10. Step 10: Run local and deployed verification and capture production-readiness evidence
   - What to do:
     - Run the local Phase 8 verification baseline after config and deploy changes:
       - backend `npx prisma validate`
       - backend `npm run build`
       - backend `npm run test`
       - frontend `npm run build`
       - frontend `npm run preview`
     - Run the deployed verification:
       - `railway status`
       - successful deploy with `npx prisma migrate deploy`
       - idempotent seed execution or seeded-plan verification
       - deployed `GET /health`
       - deployed display-safe `GET /v1/billing/plans`
       - frontend route checks
       - frontend-origin connectivity smoke success
     - Record any missing external access as an explicit blocker instead of silently declaring the phase complete.
   - Which files are affected:
     - Any files touched in Steps 2 through 9 if corrections are required
     - `C:\Users\User\Desktop\voice to clip\TypeTalk\backend\phase_8\exec_report.md` during execution
   - Expected outcome / how to verify:
     - Both repos remain locally healthy after deployment-foundation changes.
     - Production deployment behavior is proven from deployed reality, not only local confidence.
     - The deployed public plans response is display-safe and the deployed frontend origin can reach the live backend.
   - Potential risks:
     - Declaring deployment success from local builds alone.
     - Missing a connectivity, CORS, or plan-contract issue until later phases depend on it.

### Testing Strategy

- Local backend verification:
  - `npx prisma validate`
  - `npm run build`
  - `npm run test`
- Local frontend verification:
  - `npm run build`
  - `npm run preview`
- Backend contract verification:
  - billing tests prove `GET /v1/billing/plans` excludes provider/internal fields
  - env validation succeeds through the real `.env.local` and `.env.test` loading paths
- Deployment verification:
  - Railway service selection and `railway status`
  - deployed migration path using `npx prisma migrate deploy`
  - idempotent seed execution or seeded-plan verification
  - deployed `GET /health`
  - deployed display-safe `GET /v1/billing/plans`
  - verification that Railway Postgres private networking is enabled and any backup-capability limitation is documented honestly
- Frontend deployment verification:
  - deployed `/`
  - deployed `/pricing`
  - deployed `/downloads`
  - deployed `/about`
  - deployed direct-load refresh on one deep non-root route after `vercel.json` is added
  - deployed frontend-origin connectivity smoke proves real fetch success to backend `/health` and `/v1/billing/plans`
- Manual cross-checks:
  - frontend can reach the live backend
  - allowed and blocked origins behave as expected
  - no deployment step depends on hidden local state
- Completion rule:
  - if Railway, Vercel, or DNS permissions are missing, local work may be finished but the phase remains blocked rather than marked fully complete

### Success Criteria

- A written Phase 8 deployment-input matrix exists and captures the frozen public name, domains, platform scope, and pricing/quota baseline.
- Backend env documentation, `.env.local`, and `.env.test` stay aligned with the real backend env schema and feature-flag set.
- `GET /v1/billing/plans` is narrowed to the display-safe public contract and no longer exposes provider/internal identifiers.
- Railway `api` plus `postgres` deployment behavior is explicit and documented.
- Railway Postgres private networking is verified, and any live backup-capability limitation is documented without blocking Phase 8 completion.
- Backend deploy behavior uses `npx prisma migrate deploy` before app start and keeps seed behavior idempotent.
- Production and staging origin policy is explicit, exact, and does not allow arbitrary preview origins on production.
- `frontend/.env.example` exists and documents the real public frontend env contract.
- `frontend/vercel.json` exists and deployed deep SPA routes load without 404.
- A frontend-origin connectivity smoke exists and proves that `VITE_API_BASE_URL`, the deployed Vercel origin, and backend CORS work together.
- A first-deploy order and rollback runbook exists in the repo.
- Local verification passes: backend `npx prisma validate`, backend `npm run build`, backend `npm run test`, frontend `npm run build`, and frontend `npm run preview`.
- Deployed verification passes: deployed `GET /health`, deployed display-safe `GET /v1/billing/plans`, frontend direct-route checks, and frontend-origin connectivity smoke all succeed.
- The phase is not marked complete if only local verification passed but required external deployment access was unavailable.
