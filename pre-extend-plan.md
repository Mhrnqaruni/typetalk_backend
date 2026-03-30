# TypeTalk Pre-Extend Plan

Date: March 29, 2026

## Purpose

This file is a planning handoff for the executor.

It is not the final extended implementation plan.

Its job is to define:
- what is already truly complete
- what is still missing for a real public launch
- what new phases must cover
- what the executor must plan explicitly
- what "fully working and ready" means in real deployment terms

The executor should use this document to produce a detailed extension of the backend plan beyond Phase 7.

## Verified Current State

### Backend

The backend in [backend/final_plan.md](C:/Users/User/Desktop/voice%20to%20clip/TypeTalk/backend/final_plan.md) is implemented through Phase 7 and [backend/project_status.md](C:/Users/User/Desktop/voice%20to%20clip/TypeTalk/backend/project_status.md) marks Phases 0 through 7 complete.

What is already built in the backend:
- auth: email OTP, Google sign-in/linking, refresh, logout, sessions
- user and organization model
- devices and synced preferences
- billing data model and unified entitlements
- Google Play verification and RTDN
- Paddle billing migration for web and Windows
- trusted usage and weekly quota enforcement
- admin read endpoints
- security hardening, audit logs, auth rate limits, raw-IP retention job

Important distinction:
- "feature-complete backend" does not mean "production deployed product"
- the code exists, but the public deployment and full browser/frontend integration are not done yet

### Backend deployment state

Verified locally on March 29, 2026:
- Railway project resolves as `Project: TypeTalk`
- Railway environment resolves as `production`
- Railway currently reports `Service: None`
- therefore the current local directory is not actively targeting a deployed Railway service from this shell

### Frontend

The frontend at [frontend/](C:/Users/User/Desktop/voice%20to%20clip/TypeTalk/frontend) is a Vite + React SPA and currently behaves like a marketing site, not a complete web app.

Verified current frontend state:
- routes exist for home, about, manifesto, pricing, downloads, congratulations, and 404
- build passes with `npm run build`
- Vercel project info exists in [frontend/vercel info.txt](C:/Users/User/Desktop/voice%20to%20clip/TypeTalk/frontend/vercel%20info.txt)
- frontend GitHub remote points to `https://github.com/Mhrnqaruni/typetalk-frontend.git`

Verified missing frontend capabilities:
- no login page
- no signup/account flow
- no auth/session state layer
- no API client or backend base URL env wiring
- no actual calls to the backend
- no billing settings page
- no usage/quota/account dashboard
- no real terms page
- no real privacy page
- no real refund policy page
- footer legal links are placeholders
- pricing buttons are not connected to real billing
- downloads page still uses placeholder links for stores and desktop installers

### Real launch conclusion

Today, the codebase is not yet a fully usable public product.

What exists today:
- a strong backend
- a polished marketing frontend

What does not exist yet:
- a real deployed end-to-end product that a customer can visit, sign into, buy from, manage, and use from the browser

## Real-World Launch Target

The extended plan must target this exact end state:

1. Backend deployed and working on Railway.
2. Frontend deployed and working on Vercel.
3. Frontend connected to the live backend.
4. Public website loads correctly on its production domain.
5. Login and account flows work end-to-end.
6. Pricing page is real, not static-only:
   - shows correct plan information
   - can start checkout
   - can reflect current subscription state when logged in
7. Legal pages exist and are publicly accessible:
   - Terms and Conditions / Terms of Service
   - Privacy Policy
   - Refund Policy
8. Paddle readiness is real:
   - product/pricing/features visible on the site
   - legal pages accessible in navigation
   - site is live under HTTPS
   - checkout launch domain is deliberate and reviewable
9. Logged-in account features work:
   - current user/profile
   - sessions/devices
   - preferences
   - subscription/entitlement visibility
   - usage/quota visibility
10. Production operational flows work:
   - database migrations
   - healthcheck
   - webhook delivery
   - retry jobs / cron
   - security retention job
   - error visibility
11. The final result is something a real customer can use without manual internal intervention.

## Important External Constraints

The executor must plan around the real deployment and merchant constraints, not only internal code tasks.

### Paddle constraints

As verified from official Paddle docs/help on March 29, 2026:
- live selling requires website approval on a verified domain
- Paddle requires a default payment link on an approved domain
- hosted checkouts for live accounts require approval
- Paddle domain review expects the website to clearly show:
  - product/service description
  - pricing details or pricing page
  - key features/deliverables
  - Terms and Conditions
  - Refund Policy
  - Privacy Policy
  - company or legal business name in the terms
  - live HTTPS website

This means legal pages are not optional polish work. They are launch-critical merchant onboarding work.

### Vercel constraint

The frontend is a React Router SPA. The extended plan must explicitly handle production routing on Vercel so direct route loads do not 404.

That means the executor must plan either:
- SPA rewrite/fallback behavior via `vercel.json`, or
- a framework migration with an explicit routing/deploy strategy

Do not assume Vercel will automatically do the right thing without an explicit plan.

## Recommended New Phases

The cleanest extension is 4 new phases after Phase 7.

### Phase 8: Production Deployment Foundation

Primary objective:
- make the current backend and frontend deployable as real production services

Must include:
- backend Railway deploy preparation
- frontend Vercel deploy preparation
- production env inventory for both repos
- domain strategy
- production CORS strategy
- migration/deploy procedure
- healthcheck and smoke endpoint verification
- SPA routing strategy for Vercel
- GitHub-backed deployment discipline for both repos

Mandatory planning items:
- exact Railway service structure:
  - `api`
  - `postgres`
  - optional cron job strategy
- exact Vercel project behavior:
  - build command
  - output dir
  - route rewrites
  - environment variables
- exact backend public base URL
- exact frontend public base URL
- exact allowed origins list for production and previews
- exact production env var checklist
- exact migration order for first production deploy
- seed strategy for `plans`
- rollback plan if production migration or startup fails

Definition of done for this phase:
- frontend can be deployed to Vercel successfully
- backend can be deployed to Railway successfully
- frontend can hit a live backend health endpoint
- direct-load SPA routes work in production

### Phase 9: Web Auth And App Shell

Primary objective:
- convert the frontend from a marketing site into a real web application shell

Must include:
- explicit web auth architecture
- login/signup UX
- session persistence strategy
- protected routes
- logged-in navigation state
- logout behavior
- current user bootstrap

Important architectural decision the executor must address explicitly:
- how browser auth should work with the existing backend token model

The plan must not hand-wave this.

The executor must choose and justify one of these:
- secure cookie-based web session layer added to backend
- token-in-browser model with explicit refresh/storage/security strategy
- frontend-to-backend proxy/session bridge strategy

This phase must include:
- login page
- email OTP request/verify flow in browser
- Google sign-in flow in browser
- auth context/store
- startup session bootstrap
- refresh handling
- protected account routes
- proper unauthorized and expired-session behavior

Definition of done for this phase:
- a real browser user can sign in, refresh, navigate protected pages, and sign out cleanly

### Phase 10: Customer Product Integration

Primary objective:
- connect the frontend to the already-built backend features so the website becomes a working product

Must include:
- pricing page integration
- checkout initiation
- billing/subscription visibility
- usage/quota visibility
- account/settings pages
- preferences and profile management
- device/session management UI
- real downloads and store links

The plan must explicitly split public pages from logged-in app pages.

Public pages:
- home
- about
- manifesto
- pricing
- downloads
- legal pages

Logged-in app pages:
- account/profile
- billing/subscription
- usage/quota
- preferences
- sessions/devices

Pricing-specific requirements:
- plans should come from backend or a single controlled source of truth
- Pro CTA must launch real Paddle checkout, not a placeholder
- logged-in pricing state must distinguish:
  - free
  - trial
  - active paid
  - grace/payment issue if surfaced

Billing-specific requirements:
- logged-in users must be able to open Paddle customer portal or equivalent self-service path
- invoices/subscription state should be readable
- entitlements must be reflected in frontend behavior

Usage-specific requirements:
- logged-in users must be able to see quota and usage summary
- free vs paid limits must display correctly

Download/legal requirements:
- desktop and mobile download links must be real
- no `href="#"` placeholders for production launch
- terms/privacy/refund pages must exist and be linked from footer and any relevant checkout/pricing surfaces

Definition of done for this phase:
- a user can visit pricing, sign in, purchase or manage billing, and inspect account/usage state from the live frontend

### Phase 11: Merchant Readiness, Operations, And Launch Hardening

Primary objective:
- finish the non-negotiable production and merchant work so the product is truly launchable

Must include:
- Paddle merchant/domain approval readiness
- legal page completion
- company/legal information placement
- production cron jobs
- production monitoring
- operational smoke tests
- deployment runbooks
- launch checklist

Legal work that must be planned explicitly:
- Terms of Service page
- Privacy Policy page
- Refund Policy page
- company/legal entity naming consistency across site and checkout-facing content
- footer and/or header discoverability

Operational work that must be planned explicitly:
- Railway cron strategy for:
  - webhook retry job
  - security retention job
- production webhook endpoint verification
- production email delivery setup
- error tracking strategy for frontend and backend
- structured post-deploy smoke tests
- monitoring and alert review
- manual test checklist for:
  - login
  - checkout start
  - portal access
  - entitlement read
  - usage/quota read
  - direct route loads on Vercel

Merchant readiness work that must be planned explicitly:
- live HTTPS website reviewability
- approved checkout launch domain
- pricing/features/legal content alignment
- screenshot or evidence checklist if Paddle asks for review artifacts

Definition of done for this phase:
- the system is not merely deployed; it is operationally ready for real customers and merchant review

## Required New Website Surfaces

The executor should plan these pages/features explicitly, not implicitly:

### Public website surfaces
- home
- pricing
- downloads
- about
- manifesto
- terms of service
- privacy policy
- refund policy
- contact/support page or clearly accessible support path
- 404 page

### Logged-in product surfaces
- login
- account/profile
- billing/subscription
- usage/quota
- preferences
- sessions/devices

### Optional but strongly recommended
- dashboard/home after login
- success/cancel return pages for checkout or billing actions

## Exact Gaps The Executor Must Respect

These are verified current gaps and should appear as explicit planning work:

1. The frontend is currently not connected to the backend at all.
2. There is currently no login route in the frontend.
3. There is currently no API client abstraction in the frontend.
4. There is currently no frontend env/base-URL wiring for a live backend.
5. The footer legal links are placeholders, not real legal pages.
6. The pricing page is still static UI and does not initiate real billing.
7. The downloads page still contains placeholder store/download links.
8. Railway is not currently being targeted from this working directory as a selected service.
9. Vercel SPA routing behavior is not yet explicitly configured.
10. There is no complete end-to-end production smoke test path across frontend + backend.

## Non-Negotiable Planning Rules For The Executor

The extended plan must:
- stay grounded in the current codebase state
- separate deploy work from app-integration work
- separate legal/merchant readiness from UI polish
- include measurable success criteria for every phase
- include exact verification commands and user-flow checks
- include rollback/failure handling for production changes
- include GitHub backup checkpoints before major deploy-impacting changes

The extended plan must not:
- pretend the frontend is already a working app shell
- assume legal pages can be deferred until after billing work
- assume Paddle can go live without domain/legal/pricing review readiness
- assume Vercel SPA route handling will "just work"
- merge backend deploy, frontend auth, billing UI, and launch hardening into one vague mega-phase

## Expected Executor Output

The executor should now produce an extended plan that starts after Phase 7 and covers at least:
- Phase 8: Production Deployment Foundation
- Phase 9: Web Auth And App Shell
- Phase 10: Customer Product Integration
- Phase 11: Merchant Readiness, Operations, And Launch Hardening

Each phase should include:
- scope
- files/modules likely affected
- step-by-step tasks
- risks
- test/verification matrix
- definition of done

## Final Standard

The extended plan should be written against this final standard:

"A real customer can open the Vercel site, read clear product/pricing/legal information, create or access an account, sign in successfully, start or manage a subscription, view account and usage state, and use the live system against the deployed Railway backend without manual internal intervention."

## External References

These sources were checked on March 29, 2026 and should inform the executor's planning assumptions:
- Paddle sandbox/live and website approval overview: https://developer.paddle.com/build/tools/sandbox
- Paddle default payment link requirement: https://developer.paddle.com/build/transactions/default-payment-link
- Paddle domain review requirements: https://www.paddle.com/help/start/account-verification/what-is-domain-verification
- Vercel rewrite documentation: https://vercel.com/docs/routing/rewrites
