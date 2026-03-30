# TypeTalk Extended Implementation Plan

Date: March 29, 2026

## Review Reconciliation

The inspector comments from `extend-plan-comments.md` were accepted as valid and incorporated into this plan.

Key tightening applied before execution:
- lock all new web OTP routes to the same Phase 7 durable per-IP limiting, per-email issuance throttling, OTP challenge lockout, and relevant security-event behavior
- split current Paddle-readiness work from the later live Paddle activation track so merchant approval is not treated as a current execution blocker
- freeze one exact future checkout contract: frontend `/checkout` -> backend `POST /v1/billing/paddle/checkout` -> full-page redirect to the backend-returned hosted URL
- define interim paid CTA and customer-portal behavior while live Paddle access remains disabled behind explicit backend and frontend feature flags
- add an external dependency register so DNS, Google OAuth, legal, support, sender-domain, installer/store URLs, and Paddle approval inputs are tracked explicitly
- require honest launch-facing download behavior: only show platforms with verified artifacts or store URLs
- carry forward Railway Postgres private networking, Prisma validation, deployed migration checks, deployed seed verification, and explicit backup-capability documentation into Phase 8 without making backups a completion gate
- require browser Google linking from `/app/account`, a display-safe public plans API contract, mandatory frontend test tooling, and browser-level E2E coverage before final approval
- standardize cookie-bearing web-auth routes as POST-only with missing or foreign `Origin` or `Referer` rejection, and standardize the public legal route to `/refund-policy`

## 1. Purpose

This file extends the implementation plan beyond completed Phase 7.

It is grounded in:
- `backend/pre-extend-plan.md`
- `backend/final_plan.md`
- `backend/project_status.md`
- `backend/phase_7/exec_report.md`
- the current `backend/` and `frontend/` codebases
- current official platform documentation for Paddle, Vercel, Railway, Vite, Google Identity Services, and browser credential handling

This is the working plan for the remaining launch work.

It covers:
- Phase 8: Production Deployment Foundation
- Phase 9: Web Auth And App Shell
- Phase 10: Customer Product Integration
- Phase 11: Launch Hardening And Deferred Activation Prep

This plan now has two completion standards:

- current execution standard:
  a real customer can open the live site, read truthful product, pricing, legal, and support information, sign in successfully, use the logged-in app against the deployed Railway backend, and manage account, usage, preferences, and sessions without manual internal intervention
- deferred activation standard:
  once Paddle grants live merchant access, the same frontend and backend can enable the locked hosted-checkout path and customer self-service path without re-architecting browser auth, billing UI, or deploy topology

## 2. Inputs Reviewed

### Backend plan and status
- `backend/final_plan.md`
- `backend/project_status.md`
- `backend/phase_7/exec_report.md`

### Backend implementation points checked
- `backend/src/app.ts`
- `backend/src/config/env.ts`
- `backend/src/plugins/auth.ts`
- `backend/src/modules/auth/routes.ts`
- `backend/src/modules/auth/service.ts`
- `backend/src/modules/billing/routes.ts`
- `backend/src/modules/billing/service.ts`
- `backend/src/modules/billing/paddle-support.ts`
- `backend/src/modules/users/routes.ts`
- `backend/src/modules/preferences/routes.ts`
- `backend/src/modules/usage/routes.ts`
- `backend/src/modules/health/routes.ts`
- `backend/prisma/seed.ts`
- `backend/package.json`

### Frontend implementation points checked
- `frontend/package.json`
- `frontend/vite.config.js`
- `frontend/index.html`
- `frontend/src/App.jsx`
- `frontend/src/main.jsx`
- `frontend/src/components/Header.jsx`
- `frontend/src/components/Footer.jsx`
- `frontend/src/pages/Pricing.jsx`
- `frontend/src/pages/Downloads.jsx`
- frontend route/file inventory under `frontend/src/`

### Local state verified on March 29, 2026
- frontend `npm run build` passes
- backend Railway CLI resolves `Project: TypeTalk`, `Environment: production`, `Service: None`
- GitHub CLI is authenticated
- frontend remote points to `https://github.com/Mhrnqaruni/typetalk-frontend.git`
- backend remote was already verified in Phase 7

## 3. Verified Current State

### Backend

The backend is implemented through Phase 7 and is in strong shape for platform logic:
- email OTP auth
- Google sign-in and linking
- refresh/logout/sessions
- personal organizations
- devices and synced preferences
- Paddle billing for web and Windows
- Google Play verification and RTDN for Android
- unified entitlements
- trusted usage and quota enforcement
- admin read APIs
- security hardening, audit logs, auth abuse controls, retention job

This means the control plane is largely present.
It does not mean the public product is deployed and usable end to end.

### Frontend

The frontend is still a marketing SPA, not a working web product.

Verified current state:
- Vite + React + React Router SPA
- static public routes for `/`, `/about`, `/manifesto`, `/pricing`, `/downloads`, `/congratulations`, and 404
- no auth pages
- no auth/session store
- no API client
- no env-based backend URL wiring
- no checkout integration
- no billing/account/usage/preferences/sessions UI
- no real legal pages
- no real support path
- no `vercel.json`
- no frontend tests

### Deployment

Verified deployment state:
- Railway project exists
- Railway environment resolves to `production`
- current shell is not linked to a selected Railway service
- Vercel project exists for the frontend
- direct-route SPA handling is not explicitly configured yet

### Current execution boundary

The owner direction for the current execution window is:
- do make the product fully usable otherwise
- do deploy backend and frontend
- do complete browser auth, app shell, truthful pricing, legal/support pages, profile, usage, preferences, sessions, and provider-aware billing visibility
- do keep the code and UI ready for later Paddle activation
- do not make live Paddle connection the current execution blocker

That means the plan must distinguish clearly between:
- Paddle-ready work that should be executed now
- live Paddle merchant activation work that is deferred until account and domain access are available

### External inputs required before execution

These dependencies do not live in either repo and must be tracked explicitly during execution.

- `DNS and custom-domain control`
  Provided by: owner or platform operations.
  Blocks: Phase 8 final custom-domain cutover and Phase 11 final public-domain consistency.
  Fallback: use provider-generated or staging domains for non-production validation and do not mark final domain cutover complete.

- `Railway project and service permissions`
  Provided by: owner or platform operations.
  Blocks: Phase 8 deploy execution and Phase 11 cron/ops setup.
  Fallback: keep verification local only and do not mark deployment work complete.

- `Vercel project and domain permissions`
  Provided by: owner or platform operations.
  Blocks: Phase 8 frontend deployment and final public-route verification.
  Fallback: use preview deployments only and do not mark final production-domain work complete.

- `Web Google OAuth client ID and allowed origins`
  Provided by: owner or Google Cloud administrator.
  Blocks: Phase 9 browser Google sign-in and linking.
  Fallback: ship OTP-only browser auth first and mark web Google auth deferred until the client and origins exist.

- `Final legal copy and legal entity details`
  Provided by: owner, legal reviewer, or counsel.
  Blocks: Phase 10 final legal-page content and Phase 11 launch signoff.
  Fallback: implement route shells and navigation, but do not mark legal readiness complete.

- `Support mailbox or support workflow`
  Provided by: owner or operations.
  Blocks: Phase 10 support path completion and Phase 11 launch signoff.
  Fallback: publish only a clearly functioning interim support path; do not leave placeholder links.

- `Verified production email sender/domain`
  Provided by: owner or email-platform administrator.
  Blocks: Phase 11 production OTP launch.
  Fallback: staging-only auth verification; do not mark public sign-in launch-ready.

- `Windows installer artifact URL`
  Provided by: desktop release pipeline or owner.
  Blocks: Phase 10 Windows download completion.
  Fallback: remove Windows download CTA from launch-facing UI until the artifact exists.

- `Android store listing URL`
  Provided by: mobile release pipeline or owner.
  Blocks: Phase 10 Android download completion.
  Fallback: remove Android store CTA from launch-facing UI until the listing exists.

- `macOS and iOS distribution URLs`
  Provided by: release pipeline or owner.
  Blocks: only if those platforms remain in launch scope.
  Fallback: remove those platforms from launch-facing UI rather than promising unavailable downloads.

- `Paddle live approval, approved live domain, default payment link, and hosted-checkout approval`
  Provided by: Paddle plus owner merchant setup.
  Blocks: deferred live Paddle activation track only.
  Fallback: keep self-serve paid checkout and portal feature-flagged off while still shipping truthful pricing, legal pages, billing UI, and provider-aware paid-state rendering.

## 4. Additional Gaps Discovered During Analysis

These are not theoretical. They were found in the actual current code.

### 4.1 Brand inconsistency is unresolved

The backend and planning documents are consistently "TypeTalk".
The frontend currently renders "Typeless" across title, header, footer, marketing pages, downloads, and congratulations flow.

This must be resolved before launch because it affects:
- legal documents
- Paddle domain review
- checkout-facing content
- installer naming
- support identity
- public trust

### 4.2 Public pricing does not match backend pricing truth

Current frontend pricing copy says:
- Pro yearly: `$12`
- Pro monthly: `$30`
- free quota: `8,000 words per week`

Current backend seed truth says:
- `pro_monthly`: `999` cents
- `pro_yearly`: `9_999` cents
- free quota: `10,000` words per week

This mismatch must be resolved before the frontend is wired to real checkout.

### 4.3 Current frontend makes unsupported compliance claims

The pricing page currently claims:
- HIPAA compliant
- GDPR compliant

The locked backend plan explicitly says not to publicly claim these until there is real legal and operational evidence.

These claims must be removed or replaced before launch.

### 4.4 Current frontend advertises unsupported or unverified platforms

Current frontend marketing/downloads content references:
- macOS download
- iOS / App Store
- Android / Google Play
- Windows

The locked backend product model is centered on Android and Windows.
If macOS or iOS are not truly launch-ready, the site must not advertise them as available.

### 4.5 Deferred Paddle live activation still needs the website-side default payment link page

The backend already creates Paddle checkout sessions and returns `checkout_session.url`.
Official Paddle docs currently require:
- a default payment link
- an approved domain for live use
- a website page that hosts the default payment link behavior

That means the frontend still needs a dedicated checkout-launch page and later live-activation checklist, but those live Paddle tasks are now deferred until merchant access is available.

### 4.6 Frontend preview strategy is currently undefined

The backend CORS model uses exact origin allowlisting.
That does not combine well with arbitrary Vercel preview URLs if production API is used directly.

A stable preview-domain strategy must be chosen explicitly.

## 5. External Research That Informs This Plan

These findings were checked from official sources on March 29, 2026.

### Paddle

Official Paddle developer/help docs currently indicate:
- sandbox and live are meaningfully different for launch readiness
- live accounts require website approval and approved domains
- live hosted checkouts require approval
- a default payment link is mandatory to start selling
- the default payment link must point to an approved website
- domain review expects pricing, product description, terms, refund policy, privacy policy, and live HTTPS visibility

Planning impact:
- legal pages are launch blockers, not optional polish
- the frontend must include a future checkout-launch surface and non-broken interim paid-CTA behavior
- the production domain and checkout launch domain still matter, but live Paddle activation belongs to a deferred activation track rather than the current execution blocker

References:
- https://developer.paddle.com/build/tools/sandbox
- https://developer.paddle.com/build/transactions/default-payment-link
- https://developer.paddle.com/build/transactions/create-transaction
- https://www.paddle.com/help/start/account-verification/what-is-domain-verification

### Vercel

Official Vercel docs currently show:
- `vercel.json` rewrites are the correct explicit way to control SPA routing
- a rewrite from `/(.*)` to `/index.html` is a supported SPA pattern
- environment variables can be used in route configuration if needed

Planning impact:
- do not rely on Vercel "just working" for direct-route loads
- add an explicit `vercel.json`
- do not merge this into a framework migration unless there is a separate reason to migrate

References:
- https://vercel.com/docs/project-configuration/vercel-json
- https://vercel.com/docs/routing/rewrites

### Railway

Official Railway docs currently show:
- GitHub-backed deploy is the standard path
- cron jobs run the service start command on a schedule
- cron services must exit cleanly or future runs are skipped
- cron schedules are UTC-based
- minimum cadence is 5 minutes
- domains and subdomains can be attached to services explicitly

Planning impact:
- production ops should use short-lived Railway cron services for webhook retries and security retention
- billing retry cadence can be every 5 minutes
- security retention can be hourly or daily
- service/domain attachment must be explicit

References:
- https://docs.railway.com/quick-start
- https://docs.railway.com/cron-jobs
- https://docs.railway.com/networking/domains/railway-domains

### Vite

Official Vite docs currently show:
- default build output is `dist`
- `npm run build` is the static production build path
- `npm run preview` is the local production-like smoke check
- only `VITE_`-prefixed env vars are exposed to client code

Planning impact:
- frontend production envs must be introduced deliberately
- secrets must stay in backend/Railway or Vercel server config, not in client env

References:
- https://vite.dev/guide/static-deploy
- https://vite.dev/guide/env-and-mode

### Google Identity Services

Official Google docs currently show:
- web sign-in needs a Web OAuth client ID
- authorized JavaScript origins must be configured for the production and local domains
- HTTPS is required for One Tap

Planning impact:
- Phase 9 must add a separate web Google client configuration path
- production and staging origins must be explicitly configured in Google Cloud Console

Reference:
- https://developers.google.com/identity/gsi/web/guides/client-library

### Browser credential handling

Official MDN docs currently show:
- credentialed cross-origin requests require `Access-Control-Allow-Credentials: true`
- the frontend must send `credentials: "include"` for cookie-bearing requests
- `Secure` and `HttpOnly` cookies should be used for sensitive session cookies

Planning impact:
- cookie-based browser refresh flow requires an explicit CORS credentials setup
- browser auth cannot be added safely by only reusing the current bearer-only backend behavior

References:
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Allow-Credentials
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie

## 6. Locked Decisions For The Extension Work

These decisions should be treated as the default implementation direction unless new evidence forces a change.

### 6.1 Canonical production URLs

Use:
- frontend public site: `https://typetalk.app`
- frontend alternate domain: `https://www.typetalk.app` redirected to the canonical root domain
- backend API: `https://api.typetalk.app`

Recommended stable non-production URLs:
- frontend staging: `https://staging.typetalk.app`
- backend staging: `https://staging-api.typetalk.app`

Reason:
- keeps web app and backend on the same site (`typetalk.app`) while still separating concerns by subdomain
- supports same-site cookie strategy for browser auth
- avoids allowing arbitrary `*.vercel.app` origins on the production API

### 6.2 Deployment topology

Final expected deployment topology:
- Railway `api` service from `backend/`
- Railway `postgres` service
- Railway `cron-billing-webhooks` service from `backend/`
- Railway `cron-security-retention` service from `backend/`
- Vercel frontend project from `frontend/`

### 6.3 Frontend architecture choice

Do not migrate to Next.js or another framework in this extension unless a later, separate plan justifies it.

Keep:
- Vite
- React
- React Router SPA

Add:
- explicit `vercel.json` SPA rewrite behavior
- a real application shell inside the existing SPA

Reason:
- the current gap is missing product integration, not missing framework capability
- a framework migration would add scope without solving the actual launch blockers first

### 6.4 Paddle readiness now versus live activation later

Current execution scope includes:
- truthful pricing and quota alignment
- legal and support pages
- provider-aware billing and paid-state UI
- checkout route scaffolding and return routes
- future env placeholders and feature flags
- billing readiness work that leaves the frontend and backend ready for later activation

Current execution scope does not include:
- live Paddle account approval
- live default payment link setup
- live approved-domain work inside Paddle
- live hosted-checkout approval
- enabling self-serve paid checkout before those dependencies exist

These live merchant steps move to a deferred activation track and are not current execution blockers.

### 6.5 Future hosted-checkout contract

When live Paddle activation becomes available later, the only supported checkout contract is:
- authenticated user clicks a Pro CTA
- frontend routes through a dedicated `/checkout` launch page
- frontend calls backend `POST /v1/billing/paddle/checkout`
- backend creates the hosted Paddle checkout session
- frontend performs a full-page redirect to the returned `checkout_session.url`
- Paddle success and cancel return routes land back on frontend pages

Do not build around Paddle.js as the default launch model for this product.

### 6.6 Interim paid-CTA and portal behavior before live Paddle is enabled

Until live Paddle activation is explicitly enabled:
- public Pro CTAs must not open broken or half-finished checkout flows
- public pricing should render a truthful non-broken readiness state, such as a disabled or unavailable upgrade CTA
- authenticated free users on `/app/billing` should see a non-destructive message that self-serve upgrades are not enabled yet
- existing provider-backed paid or trial users must still see correct subscription, invoice, entitlement, and provider status
- customer-portal CTA should render only when a provider-backed eligible subscription exists and the portal feature is explicitly enabled

Recommended feature flags:
- backend: `BILLING_CHECKOUT_ENABLED`, `BILLING_CUSTOMER_PORTAL_ENABLED`
- frontend: `VITE_BILLING_CHECKOUT_ENABLED`, `VITE_BILLING_CUSTOMER_PORTAL_ENABLED`

### 6.7 Browser auth architecture choice

Choose:
- secure cookie-based web refresh session layer added to the backend
- short-lived access token kept in browser memory only
- bearer token on normal API requests
- `credentials: "include"` only for web auth refresh/logout endpoints

Concrete shape:
- keep existing mobile and desktop endpoints untouched
- add dedicated web auth endpoints that set or rotate a secure refresh cookie
- store refresh token in an `HttpOnly`, `Secure`, host-only cookie on `api.typetalk.app`
- keep access token out of localStorage and sessionStorage
- validate `Origin`
- require POST-only cookie-bearing endpoints
- reject missing or foreign `Origin` or `Referer` on cookie-bearing web-auth requests

Reason:
- safest way to adapt the current backend token model for the browser
- preserves existing backend auth/session logic
- avoids making every app request depend on cookie auth
- avoids persistent browser storage of long-lived refresh credentials

### 6.8 Public plans API contract

Before the website consumes plan data publicly, `GET /v1/billing/plans` must be narrowed to a stable display-safe contract.

The public contract should contain only fields needed for website and logged-in app rendering:
- `code`
- `display_name`
- `amount_cents`
- `currency`
- `billing_interval`
- `weekly_word_limit`
- `trial_days`
- `is_active`

Do not expose provider IDs, Paddle customer details, or legacy Stripe-related fields in the public plans response used by the frontend.

### 6.9 Pricing and entitlements source of truth

Use the backend plan catalog and provider state as the only authoritative source for:
- public prices
- billing intervals
- trial length
- weekly quota
- subscription status
- entitlement state

That means:
- frontend pricing UI must be driven by the display-safe `GET /v1/billing/plans` contract or a tightly controlled shared config derived from the same source
- no separate hard-coded frontend pricing constants for production

### 6.10 Legal and merchant work is launch-critical

Do not treat these as optional polish:
- Terms of Service
- Privacy Policy
- Refund Policy
- support path
- company/legal name consistency
- platform/support claims
- later checkout-domain readiness for the deferred Paddle activation track

### 6.11 Unsupported claims must be removed before launch

Until proven otherwise:
- remove HIPAA claim
- remove GDPR claim
- remove unsupported platform promises
- remove placeholder download/store links

## 7. Cross-Phase Rules

These rules apply to all remaining phases.

### Git and deploy discipline
- create a GitHub checkpoint before every deploy-impacting phase
- create another checkpoint before any production DB migration or domain/cookie/auth change
- do not make production deploy changes from a detached or unlinked local directory

### Environment discipline
- production and staging values must be separate
- do not point preview environments at production billing unless explicitly intended
- client-side env files may contain only non-secret values

### Verification discipline
- every phase ends with:
  - local build verification
  - automated tests for changed areas
  - deployed-environment smoke checks when deploys are involved
  - reportable manual user-flow checks
- frontend test tooling is mandatory before Phase 9 can be considered complete
- at least one browser-level end-to-end path, using Playwright or an equivalent tool, is required before Phase 11 can be approved

### Rollback discipline
- every phase that changes deployment, auth, schema, checkout, or legal surfacing must include:
  - pre-change backup checkpoint when the active platform supports one
  - rollback path
  - explicit stop conditions

## 8. Phase 8 - Production Deployment Foundation

### Objective

Make the backend and frontend deployable as real production services with explicit domains, environment inventories, migration order, CORS policy, and SPA routing behavior.

### Scope

Main outputs:
- production deployment architecture for both repos
- first real Railway service selection and deploy wiring
- Vercel production deployment wiring
- frontend env model
- backend env cleanup for real public origins
- explicit SPA route handling in production
- documented deployment and rollback runbooks

### Likely files and modules affected

Backend:
- `backend/.env.example`
- `backend/.env.local`
- `backend/src/config/env.ts`
- `backend/src/app.ts`
- `backend/package.json`
- optional new deploy docs such as `backend/deploy.md`, `backend/runbooks/production.md`
- optional Railway config file if chosen

Frontend:
- `frontend/.env.example` (new)
- `frontend/vercel.json` (new)
- `frontend/package.json`
- `frontend/vite.config.js`
- `frontend/src/` bootstrap files if env access or health smoke UI is added
- optional deploy docs such as `frontend/deploy.md`

### Detailed steps

#### Step 8.1 - Freeze public naming, domain model, and platform claims before deployment work

Do:
- decide whether the public product name is `TypeTalk` or `Typeless`
- standardize that name across backend, frontend, checkout-facing pages, support email, and legal documents
- freeze canonical production URLs:
  - `https://typetalk.app`
  - `https://www.typetalk.app`
  - `https://api.typetalk.app`
- freeze staging URLs if preview browser testing is required
- decide which platforms are genuinely public at launch

Expected outcome:
- one public product name
- one public domain set
- no ambiguous platform promises

Verification:
- code search for both names produces an intentional result
- written domain matrix exists in repo docs

Risks:
- if this is postponed, later legal, email, Paddle, and download work will fork in the wrong direction

#### Step 8.2 - Create a production environment inventory for both repos

Do:
- document the exact production and staging env vars for backend and frontend
- split values into:
  - secret backend vars
  - non-secret frontend build vars
  - environment-specific values
- add a frontend `.env.example`
- introduce frontend envs such as:
  - `VITE_API_BASE_URL`
  - `VITE_GOOGLE_CLIENT_ID`
  - `VITE_PUBLIC_SITE_URL`
  - `VITE_SUPPORT_EMAIL`
  - `VITE_WINDOWS_DOWNLOAD_URL`
  - `VITE_GOOGLE_PLAY_URL`
  - `VITE_BILLING_CHECKOUT_ENABLED`
  - `VITE_BILLING_CUSTOMER_PORTAL_ENABLED`
- document matching backend feature flags such as:
  - `BILLING_CHECKOUT_ENABLED`
  - `BILLING_CUSTOMER_PORTAL_ENABLED`

Expected outcome:
- there is no hidden deploy knowledge left only in CLI history or Vercel/Railway UI

Verification:
- both repos contain committed example env files
- frontend build succeeds using example/local non-secret values

Risks:
- leaking secrets into client env
- missing one production variable and discovering it only after deploy

#### Step 8.3 - Prepare the backend Railway service structure and deploy contract

Do:
- select or create the Railway `api` service from the backend repo
- attach or confirm Railway `postgres`
- confirm Railway Postgres uses private networking
- record the current Railway backup capability and any live limitation, but do not treat backups as a Phase 8 completion gate
- document final service commands:
  - web service start: `npm start`
  - pre-deploy: `npm run prisma:migrate:deploy`
- confirm backend binds to `0.0.0.0:$PORT`
- keep `GET /health` as the deployment healthcheck endpoint
- decide whether seed runs as a one-time post-deploy action or an explicit manual step
- keep `plans` seeding idempotent

Expected outcome:
- backend deploy behavior is deterministic
- migrations are run before startup, not on every process start

Verification:
- Railway service is selected in CLI
- one successful Railway deploy completes
- deployed `/health` returns `status: ok` and `database: ok`
- Railway settings verification confirms Postgres private networking and the current backup-capability status is documented honestly

Risks:
- forgetting to select the Railway service
- applying migrations against the wrong environment
- failing startup because required env vars are missing

#### Step 8.4 - Set exact production and staging CORS/origin policy

Do:
- keep production `ALLOWED_ORIGINS` exact and small:
  - `https://typetalk.app`
  - `https://www.typetalk.app`
- do not allow arbitrary `*.vercel.app` origins on production
- if preview browser testing is needed, create a stable staging frontend alias and staging backend origin policy
- prepare the backend for later credentialed browser auth by documenting that CORS must allow credentials in Phase 9

Expected outcome:
- production API origin rules are explicit, reviewable, and small

Verification:
- environment matrix includes exact origin lists
- test requests from allowed and blocked origins behave as expected

Risks:
- over-broad preview origin allowances on production
- wildcard CORS reintroduced by convenience

#### Step 8.5 - Add explicit SPA routing configuration for Vercel

Do:
- add `frontend/vercel.json`
- configure SPA rewrite behavior using an explicit rewrite to `/index.html`
- confirm Vercel build command is `npm run build`
- confirm output directory is `dist`
- keep GitHub-backed preview and production deploy behavior enabled

Expected outcome:
- direct loads of `/pricing`, `/about`, later `/login`, `/app/billing`, and other client routes do not 404 in production

Verification:
- `npm run build`
- `npm run preview`
- deployed direct-load checks for several deep routes

Risks:
- asset routing regressions if rewrite is misconfigured
- relying on Vercel defaults and discovering route 404s after launch

#### Step 8.6 - Decide the first production deployment order and rollback path

Do:
- write the exact first deploy order:
  1. backend GitHub checkpoint
  2. frontend GitHub checkpoint
  3. Railway `postgres` confirmed
  4. Railway `api` env vars set
  5. deploy backend with `prisma migrate deploy`
  6. run idempotent `prisma db seed`
  7. verify deployed backend health and billing plan read
  8. configure frontend envs in Vercel
  9. deploy frontend
  10. verify frontend can reach deployed backend health or safe public endpoint
- define rollback:
  - stop rollout on failed migration
  - redeploy last known-good commit for code-only failures
- restore DB from backup if one exists, or ship a corrective migration for schema failures

Expected outcome:
- deployment order is documented before real production changes start

Verification:
- written runbook exists in repo
- dry-run or checklist walk-through is completed

Risks:
- ad hoc deploy sequencing
- partial rollout with backend/frontend expecting different contracts

### Phase 8 verification matrix

Local:
- backend `npx prisma validate`
- backend `npm run build`
- backend `npm run test`
- frontend `npm run build`
- frontend `npm run preview`

Deploy:
- deployed migration path completes with `npx prisma migrate deploy`
- deployed seed path or equivalent idempotent plan-seed verification completes
- `railway status`
- deployed `GET /health`
- deployed `GET /v1/billing/plans`
- deployed `GET /v1/billing/plans` returns the seeded display-safe plan rows expected for launch
- deployed frontend route checks:
  - `/`
  - `/pricing`
  - `/downloads`
  - `/about`
  - one deep non-root route after `vercel.json` is added

Manual:
- browser loads the production frontend
- frontend can reach the live backend
- direct refresh on a deep route does not 404

### Phase 8 definition of done

- Railway backend deploy is real, repeatable, and documented
- Vercel frontend deploy is real, repeatable, and documented
- Railway Postgres private networking is verified, and any live backup-capability limitation is documented without blocking Phase 8 completion
- canonical production URLs are frozen
- exact production/staging env inventories exist
- Prisma validation, deployed migration, and seeded-plan verification are complete
- direct-load SPA routes work in production
- production migration and rollback procedures are written before auth and billing UI work continues

## 9. Phase 9 - Web Auth And App Shell

### Objective

Turn the frontend from a marketing-only SPA into a real authenticated web application shell, while preserving the existing backend mobile and desktop auth contract.

### Scope

Main outputs:
- browser-safe auth architecture
- dedicated web auth endpoints
- frontend API layer
- auth/session store
- login flows
- protected routes
- logged-in navigation and logout
- session bootstrap and expired-session handling

### Likely files and modules affected

Backend:
- `backend/src/app.ts`
- `backend/src/config/env.ts`
- `backend/src/plugins/auth.ts`
- `backend/src/modules/auth/routes.ts`
- `backend/src/modules/auth/service.ts`
- likely new browser-specific auth routes/helpers such as:
  - `backend/src/modules/auth/web-routes.ts`
  - `backend/src/modules/auth/web-session.ts`
- backend auth and integration tests
- new cookie/origin validation helpers

Frontend:
- `frontend/src/App.jsx` or a new route-tree module
- new `frontend/src/lib/api.js`
- new `frontend/src/lib/auth.js`
- new `frontend/src/context/AuthContext.jsx` or equivalent store
- new pages:
  - `frontend/src/pages/Login.jsx`
  - `frontend/src/pages/VerifyCode.jsx` or combined OTP page
  - `frontend/src/pages/AppShell.jsx`
  - `frontend/src/pages/AppHome.jsx`
- new route guards and layout components
- mandatory frontend test setup using Vitest + React Testing Library
- browser-level E2E or smoke setup using Playwright or an equivalent tool

### Detailed steps

#### Step 9.1 - Add frontend application infrastructure without a framework rewrite

Do:
- introduce a structured frontend app layer:
  - shared API client
  - auth store
  - route guard utilities
  - shared query/loading/error patterns
- keep React Router
- decide app route namespace

Recommended route split:
- public:
  - `/`
  - `/pricing`
  - `/downloads`
  - `/about`
  - `/manifesto`
  - `/terms-of-service`
  - `/privacy-policy`
  - `/refund-policy`
  - `/support`
- auth:
  - `/login`
- logged-in app:
  - `/app`
  - `/app/account`
  - `/app/billing`
  - `/app/usage`
  - `/app/preferences`
  - `/app/sessions`

Expected outcome:
- there is a clear separation between public marketing routes and logged-in product routes

Verification:
- route tree builds
- direct loads of public and protected routes are testable

Risks:
- bolting app state into the existing marketing pages ad hoc

#### Step 9.2 - Add dedicated web auth endpoints on the backend

Do:
- keep current mobile/desktop endpoints untouched
- add dedicated web endpoints that set or rotate a secure refresh cookie
- require the browser OTP request and verify routes to reuse the same Phase 7 auth hardening already protecting native auth:
  - durable per-IP limiter
  - durable per-email issuance throttle
  - database-backed OTP attempt lockout
  - the same relevant security-event writes for rate-limit hits, request throttles, and lockouts
- do not create a parallel weaker web-only limiter or challenge model

Recommended endpoints:
- `POST /v1/web-auth/email/request-code`
- `POST /v1/web-auth/email/resend-code`
- `POST /v1/web-auth/email/verify-code`
- `POST /v1/web-auth/google`
- `POST /v1/web-auth/refresh`
- `POST /v1/web-auth/logout`

Behavior:
- email verify and Google sign-in return an access token and user payload
- refresh token is stored server-to-browser as `Set-Cookie`
- refresh rotates the cookie and returns a fresh access token
- logout clears cookie and revokes the server session

Expected outcome:
- browser flows are isolated from native-client token flows

Verification:
- backend integration tests prove:
  - cookie is set on login
  - refresh rotates cookie
  - logout clears cookie
  - native endpoints still behave exactly as before
  - web OTP request routes hit the same durable per-IP and per-email protections as native routes
  - web OTP verify routes enforce the same challenge lockout semantics
  - the same relevant `security_events` rows are persisted for web rate-limit, throttle, and lockout cases

Risks:
- accidentally breaking existing Android/Windows client auth behavior

#### Step 9.3 - Add secure cookie handling and credential-aware CORS

Do:
- add cookie support to Fastify
- use a host-only cookie on `api.typetalk.app`
- prefer a secure name such as `__Host-typetalk_rt`
- set:
  - `HttpOnly`
  - `Secure`
  - `Path=/`
  - `SameSite=Lax` while frontend and API remain same-site subdomains
- enable credential-aware CORS for the exact allowed web origins
- validate `Origin` on cookie-bearing web auth endpoints
- keep all cookie-bearing web-auth endpoints POST-only
- reject requests with missing or foreign `Origin` or `Referer` on cookie-bearing web-auth endpoints

Expected outcome:
- browser refresh works without storing a long-lived token in JavaScript-visible storage

Verification:
- browser integration tests or request-level tests show:
  - login response sets cookie
  - refresh request succeeds only from allowed origins
  - blocked origin does not receive credentialed success
  - cookie-bearing GET requests are not used for refresh or logout
  - missing or foreign `Origin` or `Referer` is rejected consistently

Risks:
- misconfigured SameSite behavior
- forgetting `credentials: true` on backend or `credentials: "include"` on frontend

#### Step 9.4 - Implement the frontend auth client and bootstrap flow

Do:
- create a frontend API client that knows:
  - public requests
  - bearer-authenticated requests
  - cookie-bearing refresh/logout requests
- store access token only in memory
- on app boot:
  - attempt refresh if a web session cookie exists
  - if refresh succeeds, hydrate current user
  - if refresh fails, stay unauthenticated
- add automatic re-auth or redirect behavior on `401`

Expected outcome:
- page reloads preserve browser login via refresh cookie
- access token does not persist in browser storage

Verification:
- manual flow:
  - login
  - refresh page
  - remain signed in
  - logout
  - refresh page
  - remain logged out

Risks:
- infinite refresh loops
- race conditions on boot

#### Step 9.5 - Build email OTP login in the browser

Do:
- create the login UI for requesting and verifying OTP
- handle states:
  - request sent
  - resend
  - rate-limited
  - invalid code
  - expired code
  - locked challenge
- support post-login redirect back to the original intended route

Expected outcome:
- a browser user can sign in fully with the existing OTP backend model

Verification:
- manual flow and automated UI tests cover:
  - request code
  - verify code
  - invalid code
  - resend
  - rate limit behavior

Risks:
- poor UX around error states
- ignoring existing auth throttle semantics

#### Step 9.6 - Build Google sign-in for the browser

Do:
- add Google Identity Services to the frontend
- use a web OAuth client ID
- configure Google authorized JavaScript origins for local, staging, and production
- send the returned Google ID token to the new web auth backend endpoint
- support both existing-user sign-in and explicit link-required conflict handling
- preserve the existing explicit Google-linking path for already-signed-in users so the browser can eventually expose account linking, not only sign-in

Expected outcome:
- browser Google sign-in uses the same backend identity rules as native auth

Verification:
- test with a real web Google client ID in staging or local HTTPS-capable environment
- verify existing-link, new-user, and conflict cases

Risks:
- using the wrong Google client type
- forgetting authorized origins or HTTPS requirements

#### Step 9.7 - Build the logged-in app shell and route protection

Do:
- add logged-in navigation and app layout
- guard `/app/*` routes
- redirect unauthenticated users to `/login`
- add clean expired-session handling
- add logout control in the shell

Expected outcome:
- the frontend now has a real product shell, not only public marketing pages

Verification:
- direct load on `/app/account` while logged out redirects to login
- direct load while logged in restores session and renders app shell

Risks:
- route flicker
- protected routes rendering before auth bootstrap completes

#### Step 9.8 - Make frontend test tooling mandatory for auth and protected routes

Do:
- add frontend test tooling if missing
- cover:
  - auth store
  - route guard behavior
  - bootstrap success/failure
  - login form states
- add browser-level auth smoke coverage using Playwright or an equivalent tool for:
  - OTP login
  - page reload with session bootstrap
  - protected-route redirect while logged out

Expected outcome:
- frontend auth regressions are not caught only manually

Verification:
- frontend auth test suite runs in CI/local

Risks:
- skipping tests and pushing auth regressions into later billing work

### Phase 9 verification matrix

Backend:
- `npm run build`
- `npm run test`
- targeted auth integration tests

Frontend:
- `npm run build`
- frontend auth test suite
- browser-level auth smoke suite

Manual:
- request OTP
- verify OTP
- login via Google
- refresh browser tab and stay signed in
- visit a protected route directly
- logout and confirm protected routes require login again

### Phase 9 definition of done

- browser auth is real and production-shaped
- long-lived refresh credentials are not stored in localStorage/sessionStorage
- users can sign in with OTP or Google
- web OTP routes preserve the same Phase 7 hardening behavior as native auth routes
- page reload preserves session
- protected app routes are enforced
- existing backend native auth behavior remains intact

## 10. Phase 10 - Customer Product Integration

### Objective

Connect the frontend to the existing backend features so the site becomes a real customer-facing product, not only a marketing shell, while keeping live Paddle self-serve activation feature-flagged off until merchant access exists.

### Scope

Main outputs:
- real pricing page
- feature-flagged future hosted-checkout scaffolding
- provider-aware paid-state UI
- subscription and invoice visibility
- account/profile UI
- usage/quota UI
- preferences UI
- sessions/devices UI
- real downloads and store links
- checkout success/cancel flows

### Likely files and modules affected

Frontend:
- `frontend/src/pages/Pricing.jsx`
- `frontend/src/pages/Downloads.jsx`
- `frontend/src/components/Header.jsx`
- `frontend/src/components/Footer.jsx`
- new pages under:
  - `frontend/src/pages/app/`
  - `frontend/src/pages/legal/`
  - `frontend/src/pages/checkout/`
- new components for tables, cards, pagination, and empty states
- new API clients for billing, usage, preferences, sessions, devices

Backend:
- likely small compatibility additions only if frontend needs shape adjustments
- possible additions in:
  - `backend/src/modules/billing/*`
  - `backend/src/modules/users/*`
  - `backend/src/modules/preferences/*`
  - `backend/src/modules/usage/*`
- tests for any API contract refinements introduced for web UI needs

### Detailed steps

#### Step 10.1 - Resolve pricing, quota, and plan presentation against backend truth

Do:
- reconcile current frontend pricing copy with backend seeded plans
- decide final production monthly and yearly plan prices
- decide final free weekly quota display
- ensure backend seed, Paddle catalog, and frontend presentation match exactly
- remove hard-coded frontend pricing placeholders
- narrow `GET /v1/billing/plans` to the locked display-safe public contract before the website consumes it

Expected outcome:
- public pricing, backend billing logic, and Paddle catalog all describe the same product

Verification:
- compare frontend displayed pricing against:
  - `backend/prisma/seed.ts`
  - `GET /v1/billing/plans`
  - the display-safe plans response shape, with provider IDs and legacy Stripe fields excluded
  - Paddle catalog data only where relevant for later activation preparation

Risks:
- chargeback and trust issues if public price and checkout price disagree

#### Step 10.2 - Build the frontend API modules for billing, usage, account, and preferences

Do:
- extend the frontend client beyond auth
- add normalized client modules for:
  - `GET /v1/billing/plans`
  - `GET /v1/billing/subscription`
  - feature-flagged `POST /v1/billing/paddle/checkout`
  - feature-flagged `POST /v1/billing/paddle/customer-portal`
  - `GET /v1/billing/invoices`
  - `GET /v1/entitlements/current`
  - `GET /v1/usage/quota`
  - `GET /v1/usage/summary`
  - `GET /v1/me`
  - `PATCH /v1/me`
  - `GET /v1/sessions`
  - `DELETE /v1/sessions/:sessionId`
  - preferences endpoints

Expected outcome:
- frontend pages consume one coherent API layer instead of making ad hoc requests

Verification:
- page-level tests or mocks cover successful and error responses

Risks:
- inconsistent error handling
- duplicated request logic across pages

#### Step 10.3 - Build the future hosted-checkout path behind a feature flag

Do:
- add a dedicated frontend checkout-launch page, such as `/checkout`
- lock the future checkout model to the hosted-checkout contract chosen in Section 6:
  - unauthenticated Pro click -> login first, then resume checkout intent
  - authenticated Pro click -> route through `/checkout`
  - `/checkout` calls backend `POST /v1/billing/paddle/checkout`
  - frontend performs a full-page redirect to the returned `checkout_session.url`
- add success and cancel return routes
- keep this path controlled by checkout feature flags until live Paddle activation exists
- do not build around Paddle.js as the default implementation

Expected outcome:
- the frontend and backend are ready for later hosted-checkout activation without rework

Verification:
- with checkout feature flag off, `/checkout` renders a non-broken unavailable state
- request and route tests prove the frontend would use the backend-returned hosted URL when the flag is enabled
- return-route scaffolding exists and builds cleanly

Risks:
- mixing two future checkout models and implementing the wrong one
- exposing half-finished checkout when live merchant access still does not exist

#### Step 10.4 - Make the pricing page stateful for logged-in users

Do:
- fetch live plan and subscription state
- differentiate UI states for:
  - logged out
  - free
  - trial
  - paid
  - payment issue or grace if exposed
- show the correct CTA for each state:
  - sign in
  - unavailable upgrade state while checkout flag is off
  - launch `/checkout` only when checkout flag is on
  - manage subscription
  - resolve billing issue
- lock interim CTA behavior before live Paddle access exists:
  - public pricing must not expose a broken upgrade button
  - authenticated free users must see a truthful "upgrades unavailable" or equivalent readiness state
  - existing paid or trial users must still see real provider-backed status

Expected outcome:
- pricing is now a real conversion and self-service page

Verification:
- manual checks for each user state
- UI tests for CTA switching logic
- browser-level tests cover the flag-off paid CTA behavior so the site never ships with broken upgrade buttons

Risks:
- showing upgrade CTA to already-paid users
- masking payment-issue state

#### Step 10.5 - Build the billing page for subscription, invoices, and portal access

Do:
- add `/app/billing`
- show:
  - current plan
  - billing provider
  - status
  - trial and renewal dates
  - invoice list
- add customer portal launch only when the portal feature is enabled for an eligible provider-backed user
- handle Google Play users by clearly explaining that billing management happens in Google Play
- keep provider-aware paid-state rendering live even when self-serve upgrade remains disabled

Expected outcome:
- users can understand and self-manage billing from the web app

Verification:
- test free user, Paddle user, and Google Play user states
- verify invoice pagination and provider-aware portal availability or flag-off behavior

Risks:
- assuming all paid users are Paddle users
- poor handling for Google Play-managed subscriptions

#### Step 10.6 - Build account, preferences, sessions, and usage pages

Do:
- add `/app/account`
- add `/app/preferences`
- add `/app/sessions`
- add `/app/usage`
- wire them to existing backend APIs
- add browser-side Google linking from `/app/account` using the existing explicit backend linking rules

Expected outcome:
- logged-in users can inspect and manage the state the backend already exposes
- OTP-first users can link Google from the browser without leaving an account-management gap

Verification:
- manual CRUD and list checks
- automated tests for primary rendering and mutation paths
- browser account tests cover Google-link success and expected conflict or re-auth cases

Risks:
- failing to distinguish read-heavy pages from mutation-heavy pages
- poor pagination or stale state handling

#### Step 10.7 - Add a lightweight logged-in dashboard/home

Do:
- create `/app`
- summarize:
  - current plan
  - usage this week
  - key preferences
  - active sessions or devices count
  - quick actions to billing, usage, preferences, and downloads

Expected outcome:
- users land in a coherent product home after sign-in

Verification:
- signed-in redirect targets a functioning app home

Risks:
- sending users to a dead-end route after login or checkout

#### Step 10.8 - Replace placeholder download and store links with real launch behavior

Do:
- replace `href="#"` placeholders
- only show platforms with verified launch artifacts
- because these repos do not contain the desktop/mobile build and release pipelines, require verified artifact or store URLs before marking any download surface complete
- if Windows, Android, macOS, or iOS do not have verified installer or store URLs by execution time, remove that platform from launch-facing UI instead of implying availability
- ensure file names and branding match the frozen public product name

Expected outcome:
- downloads page no longer misleads users

Verification:
- every launch-facing download/store CTA resolves to a real destination
- no placeholder `#` links remain in production

Risks:
- advertising unsupported platforms
- broken or misleading store links during Paddle review

#### Step 10.9 - Add route scaffolding for legal/support pages if not already added

Do:
- create route shells and layout integration for:
  - Terms of Service
  - Privacy Policy
  - Refund Policy
  - Support / contact
- wire footer and relevant pricing/billing surfaces to these routes

Expected outcome:
- the site can support the final legal content phase without structural rework

Verification:
- footer contains real routes, not placeholders

Risks:
- leaving legal surfaces until the very end and discovering routing/navigation gaps too late

### Phase 10 verification matrix

Local:
- frontend `npm run build`
- frontend page/component tests
- browser-level E2E covers at least login, page reload bootstrap, protected-route redirect, pricing CTA flag-off behavior, and billing visibility
- backend tests if any API contract changes were required

Manual:
- logged-out user visits pricing
- signs in
- sees the locked interim paid-CTA behavior while checkout remains disabled
- sees billing page
- opens customer portal only if eligible and the feature is enabled
- views quota and usage
- edits profile/preferences
- links Google from `/app/account`
- revokes a session
- uses downloads page with only real links

### Phase 10 definition of done

- public pricing is real and aligned with backend/Paddle truth
- public plans are served through a display-safe contract
- Pro CTAs follow the locked non-broken interim behavior while live Paddle access remains disabled
- the future hosted-checkout path is scaffolded behind a feature flag using the backend-returned hosted URL model
- logged-in users can inspect billing, invoices, usage, preferences, and sessions
- downloads links are real and launch-accurate
- public and app routes are clearly separated

## 11. Phase 11 - Launch Hardening And Deferred Activation Prep

### Objective

Finish the legal, operational, monitoring, and launch-readiness work so the system is genuinely usable for real customers before live Paddle self-serve activation is turned on.

### Scope

Main outputs:
- final legal pages and discoverability
- brand/product/company consistency
- Paddle-ready activation artifacts and feature-flag controls
- production cron services
- production email delivery
- actual monitoring and alerting
- smoke test runbooks
- launch checklist

### Likely files and modules affected

Frontend:
- final public legal pages
- footer/header/support surfaces
- pricing and downloads copy
- checkout and return pages
- optional frontend error tracking bootstrap

Backend:
- `backend/src/config/env.ts`
- `backend/src/app.ts`
- `backend/src/jobs/webhook-retry.ts`
- `backend/src/jobs/security-retention.ts`
- any error tracking provider implementation
- deploy/runbook docs
- cron service docs/config

Operational docs:
- launch checklist
- Paddle review evidence checklist
- smoke test checklist
- rollback runbooks

### Detailed steps

#### Step 11.1 - Freeze final public product, company, and support identity

Do:
- resolve the final public product name across:
  - frontend copy
  - backend service text where user-visible
  - Paddle product names
  - download filenames
  - support email
  - legal pages
- freeze company/legal entity naming used in legal documents and checkout-facing material
- freeze support path:
  - `/support`
  - `support@typetalk.app`
  - or equivalent clear path

Expected outcome:
- customers, Paddle reviewers, and legal text all refer to the same product and company identity

Verification:
- site-wide search shows one approved public naming set

Risks:
- failed merchant review
- obvious trust issue for real customers

#### Step 11.2 - Publish final legal pages and make them clearly discoverable

Do:
- complete the actual content for:
  - Terms of Service
  - Privacy Policy
  - Refund Policy
- ensure footer navigation exposes them
- ensure pricing and checkout-adjacent surfaces link to them
- ensure company/legal entity is named consistently in the legal text

Expected outcome:
- the site meets the minimum public legal visibility required for merchant review

Verification:
- pages are publicly reachable without login
- pages are linked from footer and pricing/check-out relevant surfaces

Risks:
- legal pages exist but are hard to discover
- legal name mismatch across documents

#### Step 11.3 - Remove or correct unsupported claims before public launch

Do:
- remove HIPAA and GDPR claims unless real substantiation exists
- remove unsupported platform claims
- remove placeholder or speculative product promises
- make privacy and retention claims align exactly with backend behavior

Expected outcome:
- public copy matches actual product and compliance posture

Verification:
- grep the frontend for unsupported claims and placeholder links
- review pricing and downloads copy line by line

Risks:
- legal and trust exposure from inaccurate claims

#### Step 11.4 - Finalize Paddle-readiness artifacts without enabling live merchant activation

Do:
- keep checkout and portal feature flags off until live merchant access exists
- ensure the live site already contains the surfaces later needed for Paddle activation:
  - product description
  - features
  - truthful pricing
  - Terms of Service
  - Privacy Policy
  - Refund Policy
  - support path
- document the exact later activation checklist for:
  - live default payment link
  - approved domain
  - hosted-checkout approval if still required
  - merchant evidence screenshots or artifacts
- keep the code and routes ready for later activation without treating the missing Paddle approval as a current blocker

Expected outcome:
- the site is Paddle-ready without pretending that live merchant activation has already happened

Verification:
- feature flags are explicitly present and defaulted safely
- pricing, legal, and support surfaces needed for later Paddle review exist on the deployed site
- the deferred activation checklist is written and complete

Risks:
- accidentally enabling self-serve billing before merchant access exists
- leaving the later activation path ambiguous even though the UI appears ready

#### Step 11.5 - Make production email delivery real

Do:
- configure production email provider mode
- verify sender identity/domain
- ensure OTP emails are sent from the final support domain
- confirm SPF/DKIM/DMARC or provider-equivalent sender verification is complete

Expected outcome:
- customers can actually receive OTP emails in production

Verification:
- real production-like email delivery smoke test
- provider dashboard shows verified sender setup

Risks:
- successful deploy but unusable sign-in because email delivery is not actually operational

#### Step 11.6 - Turn Phase 7 and Phase 3/6 jobs into real Railway cron services

Do:
- create `cron-billing-webhooks`
  - start command: `npm run billing:webhooks:retry`
  - schedule: `*/5 * * * *`
- create `cron-security-retention`
  - start command: `npm run security:retention`
  - schedule: `17 * * * *`
- ensure both jobs terminate cleanly
- ensure UTC schedule expectations are documented

Expected outcome:
- webhook retries and raw-IP cleanup are live operational workflows, not only local scripts

Verification:
- Railway cron settings saved
- manual cron run or observed log execution succeeds
- database state changes as expected in a safe test scenario

Risks:
- long-running cron process blocks later runs
- retry cadence is too infrequent for customer-facing billing recovery

#### Step 11.7 - Add real monitoring and error visibility for frontend and backend

Do:
- choose and wire an actual error tracking provider
- connect backend through the existing Phase 7 error tracker abstraction
- add frontend error capture and release tagging
- define alert paths for:
  - repeated 5xx spikes
  - failed webhook retries
  - failed cron runs
  - auth anomaly spikes if available

Expected outcome:
- production issues become visible before users report them manually

Verification:
- test events appear from both frontend and backend
- one controlled non-production error is captured successfully

Risks:
- shipping with nominal "error tracking support" but no real provider connected

#### Step 11.8 - Create structured smoke tests and launch runbooks

Do:
- write a post-deploy smoke checklist covering:
  - backend `/health`
  - frontend public load
  - direct route load on a deep SPA route
  - OTP sign-in
  - Google sign-in
  - pricing CTA flag-off behavior before Paddle activation
  - checkout success/cancel return only if the deferred activation track is intentionally being exercised
  - billing page
  - customer-portal visibility or flag-off behavior, depending on feature flags
  - usage page
  - preferences update
  - sessions revoke
  - download links
  - webhook retry command
  - security retention command
- write rollback steps for:
  - frontend bad deploy
  - backend bad deploy
  - migration problem
  - broken checkout

Expected outcome:
- launch and rollback can be executed without relying on memory

Verification:
- checklist is executed once on staging or pre-launch production

Risks:
- production troubleshooting depends on ad hoc reasoning during incident pressure

#### Step 11.9 - Run the final pre-launch acceptance pass

Do:
- run full automated suites
- run final manual smoke test matrix
- confirm legal pages, support path, download links, pricing, paid-CTA behavior, and app shell are all live
- confirm no placeholder links remain
- confirm no unsupported claims remain

Expected outcome:
- the product is launchable in practice, not only in source code

Verification:
- formal checklist signed off from deployed reality

Risks:
- declaring "launch-ready" from local confidence instead of live evidence

### Phase 11 verification matrix

Automated:
- backend `npm run build`
- backend `npm run test`
- frontend `npm run build`
- frontend test suites
- required browser-level E2E suite from Phases 9-10

Operational:
- `GET https://api.typetalk.app/health`
- billing retry cron execution logs
- security retention cron execution logs
- provider webhook delivery checks
- error tracking test events
- email delivery smoke test

Manual:
- public navigation
- legal pages
- support path
- login with OTP
- Google sign-in
- pricing and paid-CTA behavior
- subscription visibility and portal flag behavior
- usage/quota
- direct route loads
- download links

### Phase 11 definition of done

- the site is legally and operationally ready for public users
- Paddle-ready surfaces and deferred activation artifacts are complete without forcing live merchant activation into the current execution window
- production cron jobs are running
- production email delivery works
- monitoring and alerting are connected
- the launch checklist passes against the live deployed system

## Deferred Activation Track - Live Paddle Go-Live

This track is intentionally not part of the current execution blocker.

It begins only after Paddle live merchant access and domain approval dependencies exist.

### Objective

Turn on live self-serve paid checkout and customer self-service using the already-prepared frontend and backend contract.

### Deferred steps

1. Confirm the live Paddle account is approved for selling and the intended checkout domain is eligible for activation.
2. Set the live default payment link and connect it to the already-prepared checkout-launch page.
3. Complete Paddle domain approval and hosted-checkout approval requirements, if still required.
4. Run non-production and then production smoke verification of the locked hosted-checkout contract:
   - authenticated user -> `/checkout`
   - frontend -> backend `POST /v1/billing/paddle/checkout`
   - backend -> hosted checkout session
   - browser redirect -> Paddle hosted checkout
   - success/cancel return -> frontend
5. Enable `BILLING_CHECKOUT_ENABLED` only after those smoke checks pass.
6. Enable `BILLING_CUSTOMER_PORTAL_ENABLED` only after portal verification passes for an eligible paid user.
7. Re-run billing smoke coverage on the live site and record the activation evidence.

### Deferred activation definition of done

- the live Paddle account and domain are approved
- default payment link and hosted checkout work from the approved live site
- checkout and portal feature flags are enabled intentionally
- the live hosted-checkout contract works end to end without UI or backend re-architecture

## 12. Recommended Execution Order Inside The Extension

Follow this order exactly:

1. Phase 8 deployment foundation
2. Phase 9 browser auth and app shell
3. Phase 10 product integration
4. Phase 11 launch hardening and deferred activation prep
5. Deferred live Paddle activation only after the external merchant dependencies exist

Do not collapse these into one mega-phase.

Reasons:
- deploy foundation must exist before browser integration can be tested realistically
- browser auth must exist before customer product pages can be fully integrated
- customer product integration must exist before merchant and legal readiness can be reviewed against the actual live site
- launch hardening needs the whole system deployed, not only local code
- live Paddle go-live depends on external merchant approval and therefore must remain a separate activation track

## 13. Final Acceptance Standard

### Current execution success

The current execution scope succeeds only when all of the following are true at the same time:

- `https://typetalk.app` loads as the real public product site
- `https://api.typetalk.app` serves the live backend
- direct-load SPA routes work on Vercel
- browser users can sign in with OTP and Google
- session refresh works after page reload
- web OTP routes preserve the same Phase 7 hardening behavior as native auth
- pricing reflects the actual backend truth through the display-safe plans contract
- legal pages are public and easy to find
- support path is public and real
- users can inspect billing, invoices, usage, preferences, and sessions
- existing paid or trial users see correct provider-aware billing state
- Pro CTAs follow the locked non-broken interim behavior while live Paddle access is still disabled
- download links are real and honest for only the platforms with verified artifacts or store URLs
- webhook retry and security retention are live cron workflows
- production email delivery and error visibility are operational
- frontend automated tests and browser-level E2E smoke coverage pass
- no unsupported claims, placeholder legal links, placeholder store links, or branding inconsistencies remain

### Deferred activation success

The later Paddle activation track succeeds when:

- the live Paddle account and domain are approved
- the default payment link and hosted checkout work from the approved site
- checkout and portal feature flags are enabled intentionally
- the locked hosted-checkout contract works end to end without re-architecture

## 14. Immediate Next Actions

Do these next before beginning Phase 8 implementation:

1. Approve this extended plan as the active post-Phase-7 roadmap.
2. Confirm the public product name to resolve the current TypeTalk vs Typeless mismatch.
3. Confirm whether macOS and iOS are real launch platforms or should be removed from launch-facing UI.
4. Confirm the intended production pricing and free quota if the current backend seed values are not final.
5. Create GitHub checkpoints for both `backend/` and `frontend/`.
6. Start Phase 8 with domain, env, deploy, and routing work before any browser auth coding begins.
