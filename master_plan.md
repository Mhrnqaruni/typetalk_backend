# Master Implementation Plan

## Master Implementation Plan

### Changes After Review Round 1

- Inspector comment: the plan was missing a mandatory decision gate before Phase 8 for public product identity, launch-platform scope, and pricing or quota truth. Change made: added `### Pre-Phase 8 Prerequisites` so implementation cannot start until product naming, launch platforms, pricing, quota, canonical URLs, and legal or support identity inputs are frozen.
- Inspector comment: the plan was missing a global external-dependency register with blocker ownership and fallback behavior. Change made: added `### External Dependencies And Fallbacks` with concrete owner-supplied inputs, impacted phases, and explicit fallback or not-complete rules so local-only progress cannot be mistaken for production readiness.
- Inspector comment: the plan had no measurable phase-level verification or definitions of done. Change made: added `- Definition of done` bullets under every remaining phase plus a `### Final Live-System Acceptance` checklist so each phase now has deployable evidence gates instead of only deliverables.
- Inspector comment: the governing-document status was unclear and several locked decisions from the source plan were too easy to lose. Change made: added `### Governing Scope And Authority` plus `### Locked Cross-Phase Rules`, explicitly stating that this file is the concise governing phase roadmap while `extend-plan.md` remains the detailed execution authority for exact step sequencing, locked billing behavior, fallback rules, and verification matrices.

### Project Overview

TypeTalk is now a post-Phase-7 project. The backend control plane is already built: auth, sessions, organizations, sync/preferences, Paddle billing for web and Windows, Google Play billing for Android, unified entitlements, trusted usage and quota enforcement, admin read APIs, and Phase 7 security hardening are complete.

The remaining work is the extension roadmap from [extend-plan.md](C:\Users\User\Desktop\voice to clip\TypeTalk\backend\extend-plan.md): deploy the backend and frontend as real production services, turn the frontend from a marketing SPA into a real web app, connect that app shell to the existing backend, and finish launch hardening without making live Paddle merchant activation the current blocker.

Important scope rule:
- Phases `0` through `7` are already completed and are not re-planned here.
- This master plan starts at `Phase 8` and follows the exact remaining phase structure from the approved extension plan.
- The later live Paddle go-live work remains a deferred activation track after Phase 11 and is not counted as a main execution phase.

### Governing Scope And Authority

- `master_plan.md` is the concise governing roadmap for phase boundaries, sequencing, dependencies, and completion gates for the remaining work.
- [extend-plan.md](C:\Users\User\Desktop\voice to clip\TypeTalk\backend\extend-plan.md) remains the detailed execution authority for exact step order, detailed verification matrices, locked decisions, and fallback behavior.
- If this file and `extend-plan.md` ever diverge on implementation detail, execution must follow `extend-plan.md` and then update this master plan to match.

### Pre-Phase 8 Prerequisites

These items must be frozen before Phase 8 implementation starts:
- public product name resolved across repos and public surfaces so `TypeTalk` versus `Typeless` ambiguity is gone
- launch platform scope confirmed so unsupported platforms are not carried forward accidentally
- production pricing and free quota truth confirmed so backend seed data, frontend pricing, and later Paddle-facing presentation cannot drift
- canonical production URLs and staging URLs confirmed
- legal entity naming and support identity direction confirmed enough to avoid rework in Phases 8 through 11
- GitHub checkpoints created for both backend and frontend before deployment and web-product work begins

### External Dependencies And Fallbacks

- `DNS and custom-domain control`
  Owner: owner or platform operations
  Impacts: Phases `8` and `11`
  Fallback: use provider-generated or staging domains for validation only and do not mark final production-domain work complete

- `Railway permissions and service access`
  Owner: owner or platform operations
  Impacts: Phases `8` and `11`
  Fallback: local verification may continue, but deploy, cron, and production-readiness work cannot be marked complete

- `Vercel project and domain permissions`
  Owner: owner or platform operations
  Impacts: Phases `8` and `11`
  Fallback: preview-only checks are allowed, but production frontend completion cannot be claimed

- `Web Google OAuth client ID and allowed origins`
  Owner: owner or Google Cloud administrator
  Impacts: Phases `9` and `10`
  Fallback: OTP-first browser auth may ship first, but browser Google sign-in/linking must be marked deferred until the real client exists

- `Final legal copy and legal entity details`
  Owner: owner, legal reviewer, or counsel
  Impacts: Phases `10` and `11`
  Fallback: route shells and navigation can be built, but final legal readiness cannot be marked complete

- `Support mailbox or support workflow`
  Owner: owner or operations
  Impacts: Phases `10` and `11`
  Fallback: only a clearly working interim support path may be shown; placeholder support links do not count as complete

- `Verified production email sender or domain`
  Owner: owner or email-platform administrator
  Impacts: Phase `11`
  Fallback: OTP can be tested in non-production environments, but launch-ready email auth cannot be claimed

- `Verified installer or store URLs for launch-facing platforms`
  Owner: owner or release pipeline owners
  Impacts: Phases `10` and `11`
  Fallback: remove any platform from public UI if its verified artifact or store URL does not exist yet

- `Paddle live approval, approved domain, default payment link, and hosted-checkout approval`
  Owner: Paddle plus owner merchant setup
  Impacts: deferred activation track only
  Fallback: keep checkout and customer-portal feature flags off while still completing pricing truth, billing visibility, and Paddle-readiness surfaces

### Locked Cross-Phase Rules

- Live Paddle merchant activation is not a current execution blocker; readiness work happens in Phases `8` through `11`, while live go-live remains deferred.
- The future checkout contract is fixed: authenticated user -> frontend `/checkout` -> backend `POST /v1/billing/paddle/checkout` -> full-page redirect to the backend-returned hosted URL.
- Pro CTAs must remain truthful while checkout is disabled: no broken upgrade buttons, no half-finished flows, and provider-backed paid users must still see correct billing state.
- Public plan data consumed by the frontend must use the display-safe `GET /v1/billing/plans` contract rather than leaking provider IDs or legacy Stripe fields.
- Web OTP routes must preserve the same Phase 7 durable per-IP limiting, per-email issuance throttling, OTP lockout behavior, and relevant `security_events` coverage as native auth.
- Only platforms with verified artifacts or store URLs may appear in launch-facing download UI.
- Browser-level E2E coverage is required before final approval; browser auth and billing-critical flows must not rely on manual testing only.

### Phase Breakdown

## Phase 8: Production Deployment Foundation

- Objective: make backend and frontend deployment real, repeatable, and production-shaped by freezing the public domain model, environment inventories, deploy order, rollback path, CORS policy, and Vercel SPA routing.
- Key deliverables:
  - canonical production and staging URL matrix for `typetalk.app`, `www.typetalk.app`, and `api.typetalk.app`
  - backend and frontend `.env.example` coverage with exact staging and production variable inventories
  - Railway `api` plus `postgres` deployment contract, including verified private networking and documented backup-capability status
  - explicit backend deploy flow using `npx prisma validate`, `npx prisma migrate deploy`, and idempotent seed verification
  - explicit Vercel SPA routing via `frontend/vercel.json`
  - written deployment order and rollback runbook
  - deployed verification for `GET /health` and display-safe `GET /v1/billing/plans`
- Dependencies:
  - Phases `0` through `7` completed
  - pre-Phase-8 prerequisites resolved
  - GitHub, Railway, Vercel, and DNS access available for deployment work
- Estimated complexity: High
- Definition of done:
  - Railway backend deploy is real, documented, and repeatable
  - Vercel frontend deploy is real, documented, and repeatable
  - Railway Postgres private networking is explicitly verified, and any live backup-capability limit is documented without blocking Phase 8 completion
  - deployed Prisma validation, migration, seed or seeded-plan verification, `/health`, and `/v1/billing/plans` checks all pass
  - direct-load SPA routes work in deployed Vercel, not only locally

## Phase 9: Web Auth And App Shell

- Objective: turn the frontend into a real authenticated SPA by adding browser-safe auth flows, protected routes, session bootstrap, and a logged-in app shell without regressing the native auth contract.
- Key deliverables:
  - frontend app infrastructure: API client, auth store, route guards, and app route tree
  - dedicated browser auth endpoints under `/v1/web-auth/*`
  - secure refresh-cookie flow with in-memory access token handling
  - strict credential-aware CORS and POST-only cookie-bearing auth endpoints with `Origin` or `Referer` enforcement
  - OTP login UI, Google sign-in UI, protected `/app/*` routes, logout flow, and session bootstrap after reload
  - mandatory frontend auth tests plus browser-level E2E auth smoke coverage
  - explicit reuse of Phase 7 protections for web OTP routes: durable per-IP limiting, per-email issuance throttling, OTP lockout, and relevant `security_events`
- Dependencies:
  - Phase `8` completed and deployed foundations verified
  - web Google OAuth client ID and allowed origins available for browser Google sign-in
  - production and staging origin policy finalized
- Estimated complexity: High
- Definition of done:
  - browser OTP and Google sign-in both work in the intended environments
  - refresh cookie bootstrap survives page reload without storing long-lived tokens in local or session storage
  - `/app/*` routes are protected and logout reliably clears access
  - web OTP routes prove parity with Phase 7 auth hardening and persist the same relevant security-event evidence
  - frontend auth tests and browser-level auth smoke coverage pass

## Phase 10: Customer Product Integration

- Objective: connect the new web app shell to the existing backend so customers can see real pricing, billing state, usage, preferences, sessions, and downloads while live Paddle checkout remains feature-flagged off.
- Key deliverables:
  - real pricing page aligned to backend seed truth and the display-safe `GET /v1/billing/plans` contract
  - normalized frontend API modules for billing, usage, account, preferences, and sessions
  - feature-flagged future hosted-checkout path on `/checkout` using the locked backend-returned hosted URL contract
  - provider-aware `/app/billing` page with invoices, status, and gated customer-portal behavior
  - `/app/account`, `/app/preferences`, `/app/sessions`, `/app/usage`, and `/app` dashboard pages
  - browser-side Google linking from `/app/account`
  - truthful logged-in and logged-out pricing CTA behavior while checkout stays disabled
  - downloads page with only verified platform links, plus legal and support route scaffolding
  - frontend component tests and browser-level E2E coverage for login, route protection, pricing CTA behavior, and billing visibility
- Dependencies:
  - Phase `9` completed
  - backend pricing, quota, and provider-state truth confirmed
  - verified download artifact or store URLs for any platform shown publicly
  - support and legal route structure agreed before final content work
- Estimated complexity: High
- Definition of done:
  - pricing, quota, and plan presentation match backend truth exactly
  - the public plans API consumed by the frontend is display-safe
  - `/checkout` follows the locked hosted-checkout contract while disabled states remain non-broken and truthful
  - billing, account, usage, preferences, sessions, and dashboard pages work against the live backend
  - only verified downloads or store links remain in launch-facing UI
  - browser-level tests cover pricing CTA behavior and billing visibility

## Phase 11: Launch Hardening And Deferred Activation Prep

- Objective: complete the legal, operational, monitoring, cron, email, and launch-readiness work required for a real public release while keeping self-serve Paddle activation deferred until merchant approval exists.
- Key deliverables:
  - final public product, company, and support identity frozen across frontend, backend user-visible text, legal pages, and download naming
  - published Terms of Service, Privacy Policy, Refund Policy, and support surfaces
  - removal of unsupported claims, placeholder promises, and inaccurate platform messaging
  - Paddle-ready review surfaces and feature flags kept safely off by default
  - production email delivery with verified sender domain
  - live Railway cron services for webhook retries and security retention
  - real backend and frontend monitoring or error-tracking integration
  - written smoke-test checklist, rollback runbooks, and final pre-launch acceptance evidence
- Dependencies:
  - Phase `10` completed
  - final legal copy, legal entity naming, support mailbox or workflow, and verified sender-domain inputs available
  - Railway and monitoring-provider access available for operational setup
  - any missing live Paddle approval remains explicitly deferred and must not block Phase 11 completion
- Estimated complexity: High
- Definition of done:
  - legal pages and support surfaces are public, discoverable, and truthful
  - unsupported claims, placeholder links, and branding inconsistencies are removed
  - production cron jobs, production email delivery, and monitoring are operational with evidence
  - Paddle-readiness artifacts and deferred-activation checklist are complete while checkout and portal flags remain safely controlled
  - final launch checklist passes against the deployed live system, not only local code

### Final Live-System Acceptance

The remaining program is complete only when all of the following are true:
- `https://typetalk.app` and `https://api.typetalk.app` are live and functioning as intended
- direct-load SPA routes work on the deployed frontend
- browser users can sign in, stay signed in after reload, and reach protected app routes safely
- pricing, billing visibility, usage, preferences, sessions, and downloads are truthful and backed by the live backend
- Pro CTAs remain non-broken while live Paddle checkout is still disabled
- legal pages, support path, monitoring, cron jobs, and production email delivery are all operational
- frontend automated tests and browser-level E2E coverage pass
- no unsupported claims, placeholder links, broken download links, or unresolved product-brand mismatches remain

### Total Phases: 4

Deferred activation track after the main phases:
- Live Paddle go-live happens only after Phase 11 and only after Paddle live approval, approved domain status, default payment link setup, and hosted-checkout readiness all exist.
- That deferred track is intentionally not counted in the `Total Phases` number above because it depends on external merchant approval rather than normal implementation sequencing.
