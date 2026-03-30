# TypeTalk Production Runbook

## Phase 8 Frozen Inputs

- Public product name: `TypeTalk`
- Canonical production frontend: `https://typetalk.app`
- Alternate production frontend: `https://www.typetalk.app`
- Canonical production backend: `https://api.typetalk.app`
- Recommended staging frontend: `https://staging.typetalk.app`
- Recommended staging backend: `https://staging-api.typetalk.app`
- Launch-facing platform scope for the current rollout: `Windows` and `Android`
- Non-launch-facing platforms until verified URLs exist: `macOS` and `iOS`
- Pricing baseline from `backend/prisma/seed.ts`:
  - `free`: `$0`, `10,000` words per week
  - `pro_monthly`: `$9.99`, `1,000,000` words per week, `30` trial days
  - `pro_yearly`: `$99.99`, `1,000,000` words per week, `30` trial days
- Support identity assumption for Phase 8 deployment wiring: `support@typetalk.app`

## Execution Boundary

- Phase 8 is deployment foundation only.
- Live Paddle merchant activation is deferred and is not a Phase 8 completion requirement.
- Public deployment proof must come from Railway and Vercel reality, not only local builds.

## Phase 9 Browser Auth Contract

Frozen browser-auth rules for the authenticated web app:

- Public marketing routes remain public.
- `/login` is the browser sign-in entry.
- `/app/*` is the protected authenticated SPA namespace.
- Backend browser auth uses dedicated cookie-aware routes only:
  - `POST /v1/web-auth/email/request-code`
  - `POST /v1/web-auth/email/resend-code`
  - `POST /v1/web-auth/email/verify-code`
  - `POST /v1/web-auth/google`
  - `POST /v1/web-auth/refresh`
  - `POST /v1/web-auth/logout`
- Native `/v1/auth/*` routes stay backward compatible for Android and Windows and are not repurposed for browser cookies.
- The browser refresh token lives only in an `HttpOnly` cookie set by the backend origin.
- The browser access token lives only in frontend memory and must not be persisted to `localStorage` or `sessionStorage`.
- Cookie-bearing browser-auth routes stay `POST` only and require an allowed `Origin` or `Referer`.
- The browser refresh cookie policy is locked to:
  - host-only on the backend origin
  - `HttpOnly`
  - `Secure`
  - `Path=/`
  - `SameSite=Lax`

## Current Operational State At Phase 8 Start

- Railway CLI resolves:
  - `Project: TypeTalk`
  - `Environment: production`
  - `Service: melodious-presence`
- GitHub CLI is authenticated for the owner account.
- Backend remote:
  - `https://github.com/Mhrnqaruni/typetalk_backend.git`

## Pending Sections To Be Completed During Phase 8

- Backend environment inventory
- Railway service contract
- Production and staging origin policy
- Deploy order and rollback checklist
- Phase 8 verification evidence

## Backend Environment Inventory

Backend runtime env groups for Phase 8:

- Core runtime:
  - `NODE_ENV`
  - `APP_ENV`
  - `HOST`
  - `PORT`
  - `DATABASE_URL`
- Auth and security:
  - `JWT_ACCESS_SECRET`
  - `JWT_REFRESH_SECRET`
  - `JWT_ALGORITHM`
  - `JWT_ACCESS_EXPIRY_MINUTES`
  - `JWT_REFRESH_EXPIRY_DAYS`
  - `APP_ENCRYPTION_KEY`
  - `IP_HASH_KEY_V1`
  - `OTP_EXPIRY_MINUTES`
  - `OTP_MAX_ATTEMPTS`
  - `AUTH_RATE_LIMIT_WINDOW_SECONDS`
  - `AUTH_REQUEST_CODE_MAX_PER_IP`
  - `AUTH_VERIFY_CODE_MAX_PER_IP`
  - `ADMIN_ALLOWLIST_EMAILS`
- Billing and webhooks:
  - `PADDLE_API_KEY`
  - `PADDLE_WEBHOOK_SECRET`
  - `PADDLE_PRICE_ID_PRO_MONTHLY`
  - `PADDLE_PRICE_ID_PRO_YEARLY`
  - `PADDLE_ENV`
  - `BILLING_CHECKOUT_ENABLED`
  - `BILLING_CUSTOMER_PORTAL_ENABLED`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_PRICE_ID_PRO_MONTHLY`
  - `STRIPE_PRICE_ID_PRO_YEARLY`
  - `BILLING_WEBHOOK_RETRY_BATCH_SIZE`
  - `BILLING_WEBHOOK_RETRY_BASE_DELAY_SECONDS`
  - `BILLING_WEBHOOK_RETRY_MAX_DELAY_SECONDS`
  - `BILLING_WEBHOOK_STALE_LOCK_TIMEOUT_SECONDS`
- Google Play:
  - `GOOGLE_CLIENT_ID`
  - `PLAY_PACKAGE_NAME`
  - `PLAY_SERVICE_ACCOUNT_JSON`
  - `PLAY_PUBSUB_AUDIENCE`
  - `PLAY_PUBSUB_SERVICE_ACCOUNT`
- Email and observability:
  - `EMAIL_PROVIDER_MODE`
  - `EMAIL_PROVIDER_API_KEY`
  - `EMAIL_FROM`
  - `RAW_IP_RETENTION_HOURS`
  - `SECURITY_RETENTION_BATCH_SIZE`
  - `ERROR_TRACKING_ENABLED`
  - `ERROR_TRACKING_DSN`
- Request limits and frontend origin policy:
  - `MAX_ACTIVE_DEVICES_PER_USER`
  - `ALLOWED_ORIGINS`
  - `MAX_JSON_BODY_BYTES`
  - `MAX_WEBHOOK_BODY_BYTES`

## Railway Service Contract

Observed Railway services in `production` at Phase 8 execution time:

- `Postgres`
- `melodious-presence` (current backend service slot, no deployment yet)

Backend deploy contract for the current Railway project:

- Service to target for backend deploys: `melodious-presence`
- Database service: `Postgres`
- App host binding: `0.0.0.0`
- App port source: Railway `PORT`
- Healthcheck path: `GET /health`
- Pre-deploy command: `npx prisma migrate deploy`
- Start command: `npm start`
- Seed handling: run `npx prisma db seed` once after first successful deploy, then keep future plan seeding idempotent
- Config-as-code file: `backend/railway.json`

Operational notes:

- `railway status` now resolves `Service: melodious-presence` in this workspace after explicit service linking.
- Use `railway service link melodious-presence` before deploy commands if the local workspace loses service selection.
- `railway variables --service Postgres --environment production --json` currently proves private-network attachment because:
  - `DATABASE_URL` targets `postgres.railway.internal`
  - `RAILWAY_PRIVATE_DOMAIN` is `postgres.railway.internal`
  - a persistent `RAILWAY_VOLUME_ID` is present for the database service
- Railway CLI does not expose an explicit automated-backup status field for the current Postgres service.
- Live Railway GraphQL evidence from Phase 8 execution shows the current TypeTalk project is `subscriptionType: hobby` on workspace plan `HOBBY`, with `subscriptionPlanLimit.volumes.maxBackupsCount = 0` and `maxBackupsUsagePercent = 0`.
- The currently authenticated Railway GraphQL control surface in this shell does not expose a project or workspace subscription-upgrade mutation, and `workspaceUpdate` only accepts `avatar`, `name`, and `preferredRegion`.
- Repo-side verification now includes `npm run railway:backups:check` directly from this repo. The helper uses the logged-in Railway CLI config at `~/.railway/config.json` or `RAILWAY_API_TOKEN` or `RAILWAY_TOKEN`, resolves the linked project id automatically when possible, reads the committed production volume-instance metadata from `runbooks/railway.production.json`, queries live Railway GraphQL, and exits non-zero until backup allowance plus schedule and backup evidence are all present. It now also surfaces whether the workspace already has active Railway billing plus a default payment method, so a `maxBackupsCount = 0` failure can be distinguished from "billing is not configured yet". `RAILWAY_VOLUME_INSTANCE_ID` remains available as an override when the production volume instance changes.
- Phase 8 uses this backup evidence as operational documentation only, not as a completion gate.
- If the helper shows active Railway billing, a default payment method, and still reports `maxBackupsCount = 0`, treat that as a live Railway plan or capability limitation. Do not keep changing backend code at that point; document the limitation, avoid destructive rollback assumptions, and move the workspace or project to a backup-capable Railway offering only when backup-backed operations are actually required.
- If Railway backup capability is later enabled, refresh the evidence by rechecking all three conditions against live Railway evidence:
  - `project.subscriptionPlanLimit.volumes.maxBackupsCount > 0`
  - `volumeInstanceBackupScheduleList` is non-empty or the official backup UI shows an enabled schedule
  - `volumeInstanceBackupList` is non-empty or an equivalent authenticated official Railway backup record exists

## Public Billing Plans Contract

`GET /v1/billing/plans` is the only public pricing contract Phase 8 relies on for deployed verification. The public response must stay display-safe and include only:

- `code`
- `display_name`
- `amount_cents`
- `currency`
- `billing_interval`
- `weekly_word_limit`
- `trial_days`
- `is_active`

The public response must not expose provider or internal identifiers such as:

- `id`
- `paddle_price_id`
- `stripe_price_id`
- `google_product_id`
- `google_base_plan_id`

## Production And Staging Origin Policy

Production backend origin policy for credential-ready browser traffic:

- `ALLOWED_ORIGINS=https://typetalk.app,https://www.typetalk.app`

Staging backend origin policy for explicit browser-auth rehearsal:

- `ALLOWED_ORIGINS=https://staging.typetalk.app`

Preview policy:

- Do not add wildcard preview origins such as `https://*.vercel.app` to production.
- If frontend preview browser testing needs a live backend, point the preview deployment at an explicit staging backend instead of widening production CORS.
- Local development keeps its own `.env.local` allowlist and does not change the production or staging contract.
- Preview-domain rehearsal remains cross-site when it uses `*.vercel.app` against `*.up.railway.app`, so it can prove request, verify, and logout behavior but it cannot prove `SameSite=Lax` refresh-cookie persistence across reloads.
- Cookie-persistence proof requires same-site frontend and backend domains such as `typetalk.app` plus `api.typetalk.app` or a staging pair under the same registrable domain.

## First Deploy Order

1. Confirm backend and frontend GitHub checkpoints exist.
2. Re-link the backend workspace to Railway `production` and `melodious-presence` if needed:
   - `railway link --project TypeTalk --environment production --service melodious-presence`
3. Confirm Railway Postgres service state and private-network evidence:
   - `railway status`
   - `railway service status --all`
   - `railway variables --service Postgres --environment production --json`
  - If Railway still reports zero backup allowance for the live project, document that limitation and stop before any destructive database operation that assumes a restorable backup path.
4. Set backend service variables on `melodious-presence`, including:
   - `DATABASE_URL` from Railway Postgres
   - JWT/auth secrets
   - exact `ALLOWED_ORIGINS`
   - Paddle, Google Play, email, and retention values
   - `BILLING_CHECKOUT_ENABLED=false`
   - `BILLING_CUSTOMER_PORTAL_ENABLED=false`
5. Deploy the backend to `melodious-presence`.
6. Run `npx prisma migrate deploy` against the deployed environment before opening traffic.
7. Run `npx prisma db seed` once after the first successful deploy, then keep future seed usage limited to idempotent plan verification.
8. Verify deployed backend endpoints:
   - `GET /health`
   - display-safe `GET /v1/billing/plans`
9. Link or create the Vercel frontend project and set the public `VITE_` variables.
10. Deploy the frontend with the committed `vercel.json` contract.
11. Verify deployed frontend routes:
   - `/`
   - `/pricing`
   - `/downloads`
   - `/about`
   - `/deploy-check`
12. Use `/deploy-check` from the deployed frontend origin to confirm live requests to backend `/health` and `/v1/billing/plans`.

## Rollback Rules

- Failed migration:
  - stop rollout
  - do not deploy a newer frontend
  - inspect the failed migration against the Railway Postgres service before retrying
- Code-only backend regression:
  - redeploy the previous successful Railway backend build
  - re-run `GET /health` and `GET /v1/billing/plans`
- Frontend-only regression:
  - promote or redeploy the previous successful Vercel build
  - verify `/`, `/pricing`, and `/deploy-check`
- Frontend/backend contract mismatch:
  - roll back whichever side introduced the incompatible contract
  - re-check `/deploy-check` from the frontend origin before closing the incident
- Backup dependency:
  - if a rollback would require data restoration, verify Railway backup availability before making destructive database changes
  - the current live TypeTalk project is on a Railway hobby plan state with zero backup allowance, so database-restore rollback is currently unavailable and must not be assumed until the workspace or project is moved to a plan or capability set that provides backups
