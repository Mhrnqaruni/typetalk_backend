# TypeTalk Final Backend Plan

Date: March 24, 2026

## 1. Purpose

This is the single backend plan for TypeTalk.

It replaces:
- `backend/codex_plan.md`
- `backend/congress_plan.md`
- `backend/claude_plan.md`

This plan is intentionally:
- complete enough to build from
- simple enough to follow
- aligned with Railway deployment
- aligned with local PostgreSQL development
- not overloaded with phase-2 complexity

## 2. Final Decisions

These decisions are locked unless we explicitly change them later.

### Product shape

TypeTalk should work like this:
- one account works across Android and Windows
- free tier has a weekly usage limit
- paid tier unlocks higher or unlimited usage
- there is a 30-day Pro trial
- raw audio, transcript text, and app context are not stored by default
- user preferences sync across devices

### Backend role

The backend is a control plane first.

It owns:
- accounts
- auth
- devices
- billing
- entitlements
- usage tracking
- quota enforcement
- preferences
- security logs

It does **not** become a giant AI monolith in v1.

### Tech stack

Use:
- Node.js 22
- TypeScript
- Fastify
- Zod
- PostgreSQL
- Prisma
- Railway

Do **not** use in the final plan:
- FastAPI
- Alembic
- Redis
- Celery
- Docker Compose

Important note:
- Docker and Alembic are not substitutes for each other.
- Since this project is using Node.js + Prisma, database migrations will use `Prisma`, not Alembic.
- Since you already have local PostgreSQL, we do not need Docker for local DB setup.

### Auth decision

V1 will use:
- email OTP
- Google sign-in

V1 will **not** use:
- magic-link as the primary email flow
- password-first auth

Reason:
- OTP is better for Android and Windows app UX
- users stay in the app instead of switching into email links
- it is easier to explain and support across devices

### Token decision

Use:
- JWT access tokens with `HS256`
- hashed refresh tokens stored in `sessions`

Default lifetimes:
- access token: 15 minutes
- refresh token: 30 days

### Trusted usage decision

Public launch will use a server-owned usage model.

That means:
- the backend creates a server-owned realtime session before dictation starts
- the client cannot submit its own word count as billable truth
- `POST /v1/usage/finalize` only succeeds when the backend can derive or verify the final word count from a server-owned session or provider-linked trusted result

Practical rule:
- raw client telemetry can be used for analytics only
- raw client telemetry cannot be used for hard free-tier or paid-tier enforcement

### Release gate decision

TypeTalk must not publicly launch free self-serve usage until Phase 5 is complete.

This prevents:
- unlimited free usage before quota enforcement exists
- billing without entitlement correctness
- production drift between auth, billing, and usage

## 3. What We Are Building In V1

V1 backend must include:
- email OTP auth
- Google sign-in
- session management
- personal user workspace
- device registration
- session management UI endpoints
- Stripe billing for web and Windows
- Google Play billing verification for Android
- unified entitlements
- usage tracking
- weekly quota logic
- synced preferences
- personal dictionary
- writing profiles
- app profiles
- webhook verification and deduplication
- basic admin visibility
- Railway deployment

V1 backend must **not** include:
- storing raw audio
- storing raw transcript history
- storing raw screen/app context
- teams UI
- advanced support impersonation
- Redis queueing
- complex partitions
- dead-letter systems
- generated SDKs
- PostgreSQL RLS as a launch blocker

Public launch blockers:
- trusted quota enforcement
- webhook retry-safe processing
- OTP brute-force protection
- Stripe billing correctness
- Google Play verification plus acknowledgment
- unified entitlements

## 4. Product Assumptions

These are the assumptions this plan uses:

- Android paid features use Google Play Billing
- Windows/web payments use Stripe
- Windows is currently distributed outside a store billing model that would block Stripe
- TypeTalk will copy Typeless structurally:
  - free weekly cap
  - paid Pro plan
  - 30-day trial
  - zero-retention-by-default
  - synced preferences instead of cloud transcript history

If Windows distribution changes later, billing rules may need to change too.

## 5. High-Level Architecture

### Railway services in v1

Keep v1 simple:

1. `api`
- public Fastify backend
- serves all REST endpoints
- receives Stripe webhooks
- receives Google RTDN push notifications
- owns realtime session issuance for trusted usage
- talks to PostgreSQL

2. `postgres`
- Railway PostgreSQL in the same Railway project
- private networking
- backups enabled

Optional after v1:

3. `cron`
- a short Railway cron job that processes pending webhook/event rows every minute if needed
- this is the v1 retry path for failed webhook/event processing

This keeps the first deployment simple:
- no Redis
- no dedicated worker on day 1
- no extra infrastructure unless traffic proves we need it

### Local development

Use:
- local PostgreSQL installed on your machine
- Prisma migrations
- `.env.local`

Do not require:
- Docker
- Redis

## 6. Backend Folder Shape

Target backend structure:

```text
backend/
  final_plan.md
  package.json
  tsconfig.json
  .env.example
  prisma/
    schema.prisma
    migrations/
    seed.ts
  src/
    app.ts
    server.ts
    config/
    plugins/
    modules/
      auth/
      users/
      organizations/
      devices/
      billing/
      entitlements/
      usage/
      preferences/
      security/
      admin/
      health/
    lib/
    jobs/
  test/
```

## 7. Database Design

We will use one PostgreSQL database schema for both local development and Railway production.

### 7.1 Core identity tables

#### `users`

Purpose:
- one row per person

Key fields:
- `id`
- `primary_email`
- `email_verified_at`
- `display_name`
- `avatar_url`
- `status`
- `created_at`
- `updated_at`
- `deleted_at`

Rules:
- soft delete supported
- unique normalized email for active users

#### `auth_identities`

Purpose:
- external login identities linked to users

Key fields:
- `id`
- `user_id`
- `provider`
- `provider_user_id`
- `provider_email`
- `created_at`

Rules:
- unique `(provider, provider_user_id)`
- Google `sub` is the durable Google identity key

#### `email_challenges`

Purpose:
- OTP or magic-link verification

Key fields:
- `id`
- `email`
- `challenge_type`
- `code_hash`
- `purpose`
- `requested_ip_hash`
- `attempt_count`
- `max_attempts`
- `created_at`
- `expires_at`
- `used_at`
- `superseded_at`

Rules:
- store only hashed code/token
- never store reusable raw auth tokens in plaintext
- use 6-digit OTP codes in v1
- default expiry is 10 minutes
- max 5 verification attempts per challenge
- only one active challenge per email + purpose
- requesting a new code supersedes the previous active challenge

#### `sessions`

Purpose:
- refresh-token sessions

Key fields:
- `id`
- `user_id`
- `device_id`
- `refresh_token_hash`
- `user_agent`
- `last_ip_hash`
- `last_ip_country_code`
- `last_used_at`
- `expires_at`
- `revoked_at`
- `created_at`

Rules:
- refresh tokens stored only as hashes
- refresh token rotation is mandatory
- when a refresh token is exchanged, the old token is invalidated
- refresh-token reuse after rotation is treated as possible token theft and should revoke the session family

### 7.2 Organization tables

We keep the schema organization-ready from the start, but we keep product behavior simple in v1.

#### `organizations`

Purpose:
- personal or future team workspace

Key fields:
- `id`
- `name`
- `type` (`personal`, `team`)
- `owner_user_id`
- `created_at`

#### `organization_members`

Purpose:
- workspace membership

Key fields:
- `organization_id`
- `user_id`
- `role`
- `created_at`

Rule:
- each new user gets a personal organization on signup

### 7.3 Device tables

#### `devices`

Purpose:
- register app installations/devices

Key fields:
- `id`
- `user_id`
- `platform` (`android`, `windows`)
- `installation_id`
- `device_name`
- `os_version`
- `app_version`
- `locale`
- `timezone`
- `last_seen_at`
- `created_at`

Rules:
- installation UUID should come from the app
- do not store invasive hardware fingerprints
- devices belong to users, not organizations
- current organization context belongs to the authenticated request/session, not the device row
- default max active devices per user in v1: 10

### 7.4 Billing tables

#### `plans`

Purpose:
- internal product plans

Seed values:
- `free`
- `pro_monthly`
- `pro_yearly`

Required fields:
- `id`
- `code`
- `display_name`
- `amount_cents`
- `currency`
- `billing_interval`
- `weekly_word_limit`
- `trial_days`
- `stripe_price_id`
- `google_product_id`
- `google_base_plan_id`
- `is_active`

Rules:
- price and quota policy should come from the database, not from scattered constants in code

#### `provider_customers`

Purpose:
- link organization/user to billing provider customer

Key fields:
- `id`
- `organization_id`
- `provider` (`stripe`, `google_play`)
- `external_customer_id`

#### `subscriptions`

Purpose:
- store provider subscription state

Key fields:
- `id`
- `organization_id`
- `plan_id`
- `provider`
- `external_subscription_id`
- `status`
- `is_trial`
- `conflict_flag`
- `trial_ends_at`
- `current_period_start`
- `current_period_end`
- `canceled_at`
- `created_at`
- `updated_at`

#### `purchase_tokens`

Purpose:
- Google Play purchase token tracking

Key fields:
- `purchase_token`
- `organization_id`
- `subscription_id`
- `product_id`
- `base_plan_id`
- `linked_purchase_token`
- `status`
- `acknowledged_at`
- `created_at`
- `updated_at`
- `last_verified_at`

Rules:
- use `purchase_token` as the durable Google key
- never use `orderId` as the durable dedupe key
- initial Google purchases must be acknowledged after successful secure verification

#### `entitlements`

Purpose:
- one internal access view for the app

Key fields:
- `id`
- `organization_id`
- `user_id`
- `code`
- `status`
- `billing_overlap`
- `primary_subscription_id`
- `starts_at`
- `ends_at`
- `source_provider`
- `updated_at`

Allowed values should include:
- `free`
- `trial_active`
- `pro_active`
- `pro_grace`
- `payment_issue`
- `expired`
- `suspended`

Rules:
- billing entitlements in v1 are resolved primarily by `organization_id`
- `user_id` is optional support metadata and can be null for organization-wide entitlements
- if multiple active paid subscriptions exist for the same organization, access stays paid but `billing_overlap` must be set so the product can warn the user

#### `webhook_events`

Purpose:
- durable provider event receipt

Key fields:
- `id`
- `provider`
- `external_event_id`
- `payload_json`
- `status`
- `attempt_count`
- `last_error`
- `next_retry_at`
- `locked_at`
- `received_at`
- `processed_at`

Rules:
- unique `(provider, external_event_id)`
- insert first, then process
- `status` must follow a real state machine:
  - `received`
  - `processing`
  - `processed`
  - `failed`
- a duplicate webhook must not destroy retryability
- failed rows must be retried by cron or a later worker

#### `idempotency_keys`

Purpose:
- prevent duplicate business actions

Key fields:
- `scope`
- `idempotency_key`
- `request_hash`
- `response_status`
- `response_body_json`
- `created_at`
- `expires_at`

Rules:
- do not store raw transcript text in idempotency responses
- use this for:
  - checkout session creation
  - Google verification/restore
  - device registration
  - dictation finalization

### 7.5 Usage tables

#### `realtime_sessions`

Purpose:
- server-owned session used for trusted usage enforcement

Key fields:
- `id`
- `organization_id`
- `user_id`
- `device_id`
- `provider`
- `provider_session_ref`
- `status`
- `started_at`
- `ended_at`
- `final_word_count`
- `trusted_result_source`

Rules:
- every hard-quota dictation flow must start with a server-owned realtime session
- a finalize request without a valid realtime session cannot become billable truth
- if trusted final usage cannot be derived, the request must not spend quota

#### `quota_windows`

Purpose:
- enforce weekly usage limits

Key fields:
- `id`
- `organization_id`
- `user_id`
- `feature_code`
- `window_start`
- `word_limit`
- `used_words`
- `updated_at`

Rules:
- quota check and quota write must happen in one DB transaction
- the free-week window starts at Monday 00:00 UTC
- `window_start` is stored in UTC
- if a request would exceed the remaining free quota, reject the whole request

#### `usage_events`

Purpose:
- per-use usage records

Key fields:
- `id`
- `organization_id`
- `user_id`
- `device_id`
- `realtime_session_id`
- `idempotency_key`
- `feature_code`
- `provider`
- `word_count`
- `audio_seconds`
- `request_count`
- `status`
- `occurred_at`

Rules:
- store counts and metadata
- do not store raw transcript text
- every billable usage row should be traceable back to its realtime session and idempotent finalize request

#### `usage_rollups_weekly`

Purpose:
- reporting and dashboards

Key fields:
- `organization_id`
- `user_id`
- `week_start`
- `total_words`
- `total_audio_seconds`
- `total_requests`

### 7.6 Preference tables

#### `user_preferences`

Purpose:
- simple user defaults

Key fields:
- `user_id`
- `default_language`
- `auto_punctuation`
- `remove_fillers`
- `auto_format`
- `updated_at`

#### `dictionary_entries`

Purpose:
- personal dictionary entries

Key fields:
- `id`
- `user_id`
- `organization_id`
- `phrase`
- `created_at`

#### `writing_profiles`

Purpose:
- reusable writing style profiles

Key fields:
- `id`
- `user_id`
- `organization_id`
- `name`
- `tone`
- `rules_json`

#### `app_profiles`

Purpose:
- app-specific behavior

Key fields:
- `id`
- `user_id`
- `organization_id`
- `app_key`
- `writing_profile_id`
- `settings_json`

### 7.7 Security and audit tables

#### `ip_observations`

Purpose:
- abuse detection with privacy protection

Key fields:
- `id`
- `user_id`
- `organization_id`
- `ip_hash`
- `hash_key_version`
- `raw_ip_ciphertext`
- `raw_ip_expires_at`
- `country_code`
- `region`
- `asn`
- `created_at`

Rules:
- raw IP is short-lived only
- long-term correlation uses HMAC hash

#### `security_events`

Purpose:
- login, rate limit, abuse, suspicious activity

Key fields:
- `id`
- `organization_id`
- `user_id`
- `device_id`
- `event_type`
- `severity`
- `ip_hash`
- `metadata_json`
- `created_at`

#### `audit_logs`

Purpose:
- important system and admin actions

Key fields:
- `id`
- `organization_id`
- `actor_type`
- `actor_id`
- `target_type`
- `target_id`
- `action`
- `request_id`
- `metadata_json`
- `created_at`

### 7.8 Tables we are not adding in v1

Do not add these now:
- `outbox_events`
- `dead_letter_events`
- partition tables
- advanced support-session tables

They can be added later if scale requires them.

## 8. Auth Rules

### Final auth model

Use:
- email OTP
- Google sign-in
- short-lived access token
- long-lived refresh session

Do not use:
- password-first login

### OTP rules

Use these rules exactly:

1. OTP length is 6 digits.
2. OTP expiry is 10 minutes.
3. Maximum 5 verification attempts per challenge.
4. One active challenge per email + purpose.
5. `POST /v1/auth/email/resend-code` supersedes the old active challenge.
6. Request-code and verify-code endpoints must both be rate-limited.
7. Challenge rows should carry requested IP hash for abuse correlation.

### Safe Google linking rules

Use these rules exactly:

1. If Google `sub` already exists, sign in that user.
2. If the user is already logged in, allow linking only after recent re-auth.
3. If no user exists for that email, create a new user.
4. If a user exists for that email but no Google identity is linked yet, do not auto-merge silently.
5. Require explicit authenticated linking or OTP confirmation.

This prevents account takeover by email collision.

### Refresh rotation rules

Use these rules exactly:

1. Every successful refresh returns a new refresh token.
2. The previously used refresh token is revoked immediately.
3. Reuse of an already rotated refresh token is treated as suspicious.
4. Suspicious refresh reuse should:
   - revoke the active session family
   - emit a `security_event`
   - require the user to sign in again

## 9. Billing Rules

### Stripe for web and Windows

Use:
- Stripe Checkout
- Stripe Customer Portal

Required endpoints:
- create checkout session
- create customer portal session
- get current billing/subscription summary
- Stripe webhook endpoint

Required Stripe webhook handling:
- verify signature from raw request body
- insert webhook row first
- dedupe using unique event id
- mark row `received`
- return a retry-safe result path
- process through a durable state machine
- update subscription state
- recompute entitlements

Practical v1 processing model:
- insert or upsert event row
- if processing can finish safely in-request, mark `processed`
- if processing fails or is deferred, keep the row retryable
- Railway cron picks up `received` or `failed` rows and retries them
- subscription cancellation, payment-method changes, and invoice self-service for Stripe are handled through the customer portal route

### Google Play for Android

Use:
- app-side Google Play Billing
- backend verification
- RTDN

Required behavior:
- client sends account mapping info
- backend verifies purchase/subscription state
- backend stores purchase token
- RTDN events are verified, stored durably, and acknowledged quickly
- entitlement is recomputed from provider state

Important rules:
- use `purchaseToken` as the durable Google key
- support `linkedPurchaseToken`
- do not grant access while state is pending
- if provider sync is not safe to finish inside the webhook request, process the pending event shortly after via cron or a later worker
- acknowledge initial Google purchases after successful secure verification
- retry acknowledgment if the first attempt fails
- subscription cancellation for Google Play is managed through Google Play; the backend reflects provider state after verify/RTDN updates

### Unified entitlements

The app should never ask:
- "is this a Stripe user?"
- "is this a Google Play user?"

The app should only ask:
- "what is the current entitlement?"

This is why `GET /v1/entitlements/current` is required.

### Dual subscription conflict policy

This policy is required in v1:

1. One organization can have multiple provider subscriptions recorded.
2. Effective access is computed once by the entitlement engine.
3. If any valid paid source is active, the organization remains paid.
4. If more than one paid source is active at the same time, set `billing_overlap = true`.
5. The app should warn the user that duplicate billing exists.
6. Stripe checkout creation should refuse to start if the organization already has an active paid entitlement.
7. Android purchase UI should also check current entitlement before starting a new Play purchase flow.
8. If overlap still happens, do not auto-refund or auto-cancel; keep records, warn the user, and direct them to the correct provider to manage cancellation.

## 10. Usage And Quota Rules

### Free plan rule

Start with:
- free plan weekly cap
- Pro unlimited or high cap

Default window rule:
- week starts Monday 00:00 UTC
- quota windows are stored in UTC
- overflow rejects the entire request

### Usage enforcement rule

Quota enforcement must happen in one transaction:

1. open transaction
2. find or create current quota window
3. attempt to increment usage
4. if limit exceeded, reject
5. write usage event
6. commit

Do not use:
- read count
- then check
- then write later

That approach causes race conditions.

### Trusted finalize rule

`POST /v1/usage/finalize` must not accept a client-declared billable word count as authoritative.

It must require:
- a valid `realtime_session_id`
- a trusted final result tied to that session

Trusted result means one of:
- a backend-controlled transcript/final event
- a provider result fetched or verified by the backend and mapped to the server-owned session

If trusted final usage is unavailable:
- do not spend quota
- do not create a billable usage row
- record telemetry only if needed

### What usage data to store

Store:
- words
- audio seconds
- feature used
- provider used
- request counts
- timestamps
- success/failure

Do not store:
- raw transcript body
- raw prompt text
- raw app context

## 11. Audio And AI Scope

This backend plan is for the backend control plane.

It does not force a giant AI monolith, but it does require a trusted billable session design.

For now, the final plan only assumes:
- the backend will receive enough trusted data to apply entitlements and usage rules
- the backend will not store raw audio or raw transcript text by default
- hard paid/free limits must not depend only on raw client telemetry
- hard quota enforcement should rely on `POST /v1/usage/finalize` plus trusted provider or server-owned usage data

V1 implementation rule:
- every public dictation flow that can spend quota must start with `POST /v1/realtime/session`
- if the chosen provider integration cannot produce trusted server-verifiable final word counts, that flow cannot be used for hard quota enforcement in public launch
- telemetry-only client reports are allowed, but they must not unlock unlimited usage

If we later write a separate audio pipeline plan, it can decide:
- direct client-to-provider streaming
- backend proxy streaming
- provider-specific integrations

That audio pipeline should be a separate document, not mixed into this backend master plan.

## 12. API Surface

Use versioned routes:
- `/v1/...`

### 12.0 API conventions

Standard error shape:

```json
{
  "error": {
    "code": "quota_exceeded",
    "message": "Weekly free quota exceeded.",
    "details": null
  },
  "request_id": "req_123"
}
```

Pagination convention:
- use cursor pagination
- request: `?limit=20&cursor=...`
- response includes `items` and `next_cursor`

Body limits:
- auth and normal JSON routes should use small explicit limits
- webhook routes should use explicit raw-body limits
- this backend is not a bulk file-upload API in v1

### 12.1 Auth

- `POST /v1/auth/email/request-code`
- `POST /v1/auth/email/resend-code`
- `POST /v1/auth/email/verify-code`
- `POST /v1/auth/google`
- `POST /v1/auth/link/google`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/me`

### 12.2 Organizations

- `GET /v1/organizations/current`
- `GET /v1/organizations/members`

V1 does not need full team UI yet, but the model should exist.

### 12.3 Users

- `PATCH /v1/me`
- `DELETE /v1/me`
- `GET /v1/sessions`
- `DELETE /v1/sessions/:sessionId`

### 12.4 Devices

- `POST /v1/devices/register`
- `PATCH /v1/devices/:deviceId/heartbeat`
- `GET /v1/devices`
- `DELETE /v1/devices/:deviceId`

### 12.5 Billing

- `GET /v1/billing/plans`
- `GET /v1/billing/subscription`
- `POST /v1/billing/stripe/checkout-session`
- `POST /v1/billing/stripe/customer-portal`
- `POST /v1/billing/google-play/verify-subscription`
- `POST /v1/billing/google-play/restore`
- `GET /v1/billing/invoices`

Provider webhooks:
- `POST /v1/webhooks/stripe`
- `POST /v1/webhooks/google-play/rtdn`

### 12.6 Entitlements

- `GET /v1/entitlements/current`

### 12.7 Usage

- `POST /v1/realtime/session`
- `POST /v1/usage/finalize`
- `POST /v1/usage/events`
- `GET /v1/usage/summary`
- `GET /v1/usage/quota`

Rules:
- `realtime/session` creates the server-owned session used for trusted quota enforcement
- `usage/finalize` is the billable/quota path
- `usage/events` is telemetry only

### 12.8 Preferences

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

### 12.9 Admin

Keep admin simple in v1:

- `GET /v1/admin/users/:userId`
- `GET /v1/admin/subscriptions`
- `GET /v1/admin/usage`

Do not build complex admin impersonation in v1.

## 13. Privacy And Security Rules

These rules are mandatory.

### Data retention

Store long-term:
- accounts
- subscriptions
- entitlements
- usage counts
- billing references
- preferences
- dictionary entries
- audit logs

Store short-term only:
- raw IP
- raw webhook payloads if sensitive
- temporary debugging data

Do not store by default:
- raw audio
- raw transcript text
- raw screen/app context
- raw payment instrument data

### IP handling

Use:
- HMAC-hashed IP for long-term correlation
- encrypted raw IP with expiry for short-term abuse handling

Do not keep raw IP forever.

### Required protections

- hash refresh tokens
- hash email challenge codes
- verify Stripe signatures
- verify Google RTDN trust headers/tokens
- use idempotency for sensitive write routes
- use request logging
- keep audit logs for admin-sensitive actions
- rate-limit auth endpoints
- enforce OTP attempt limits in the database layer
- configure explicit request body limits

### HTTP and CORS rules

Use:
- explicit `ALLOWED_ORIGINS`
- strict CORS allowlist
- request body size limits per route class

Do not use:
- wildcard CORS in production
- unlimited request body parsing

### Compliance posture

Do not publicly claim:
- HIPAA compliant
- SOC 2 certified
- ISO 27001 certified
- GDPR compliant

until legal and operational evidence actually exists.

## 14. Environment Variables

### Required local and production variables

```env
NODE_ENV=development
APP_ENV=local
PORT=3000

DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/typetalk_dev

JWT_ACCESS_SECRET=replace_me
JWT_REFRESH_SECRET=replace_me
JWT_ALGORITHM=HS256
JWT_ACCESS_EXPIRY_MINUTES=15
JWT_REFRESH_EXPIRY_DAYS=30
APP_ENCRYPTION_KEY=replace_me
IP_HASH_KEY_V1=replace_me

GOOGLE_CLIENT_ID=replace_me

STRIPE_SECRET_KEY=replace_me
STRIPE_WEBHOOK_SECRET=replace_me
STRIPE_PRICE_ID_PRO_MONTHLY=replace_me
STRIPE_PRICE_ID_PRO_YEARLY=replace_me

PLAY_PACKAGE_NAME=replace_me
PLAY_SERVICE_ACCOUNT_JSON=replace_me
PLAY_PUBSUB_AUDIENCE=replace_me
PLAY_PUBSUB_SERVICE_ACCOUNT=replace_me

EMAIL_PROVIDER_API_KEY=replace_me
EMAIL_FROM=no-reply@typetalk.app

OTP_EXPIRY_MINUTES=10
OTP_MAX_ATTEMPTS=5
MAX_ACTIVE_DEVICES_PER_USER=10
ALLOWED_ORIGINS=http://localhost:3000,https://typetalk.app
MAX_JSON_BODY_BYTES=1048576
MAX_WEBHOOK_BODY_BYTES=524288
```

Notes:
- pricing and quota values should live in the `plans` table
- env vars should not be the main source of truth for plan prices

### Env files

Use:
- `.env.example`
- `.env.local`
- `.env.test`

Do not commit real secrets to git.

## 15. Local Development Path

This project uses local PostgreSQL directly.

### Local PostgreSQL

Expected:
- PostgreSQL installed locally
- one development DB
- one separate test DB

Suggested DB names:
- `typetalk_dev`
- `typetalk_test`

### Local setup steps

1. Install Node.js 22.
2. Install PostgreSQL locally.
3. Create `typetalk_dev` and `typetalk_test`.
4. Create `backend/.env.local`.
5. Initialize the backend project.
6. Initialize Prisma.
7. Create the first migration.
8. Run the API locally.

### Local commands to support

We should support commands like:

```bash
npm install
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run dev
npm run test
```

### Database migration rule

Use:
- `prisma migrate dev` locally
- `prisma migrate deploy` in Railway deployment

Do not:
- run migrations on every app startup

## 16. GitHub To Railway Path

This is the deployment path we should follow.

### Step 1: GitHub

Put the repository on GitHub with:
- backend source
- Prisma schema
- `.env.example`
- Railway config if needed

### Step 2: Railway project

Create one Railway project with:
- `api` service
- `postgres` service

### Step 3: PostgreSQL in Railway

In Railway:
- add PostgreSQL service
- keep it on private networking
- enable backups

### Step 4: API service in Railway

Deploy backend from GitHub.

The API service must:
- listen on `0.0.0.0:$PORT`
- expose `/health`
- read `DATABASE_URL`

### Step 5: Railway variables

Set:
- all secrets listed in the env section
- `DATABASE_URL` via Railway reference variable from Postgres

### Step 6: Migration step

Use Railway pre-deploy or CI to run:

```bash
npx prisma migrate deploy
```

Then start the app.

### Step 7: Public domain

Expose:
- public API domain on Railway

Suggested:
- `api.typetalk.app`

### Step 8: Healthchecks

Use:
- `GET /health`

Healthcheck should confirm:
- app is running
- DB connection is available

## 17. Railway Rules

These rules must stay in the final implementation:

- Postgres and API are in the same Railway project
- Postgres uses private networking
- secrets are stored in Railway variables
- backups are enabled
- healthcheck is required
- migrations run before deploy completes

Optional after v1:
- add a short Railway cron job to process pending webhook rows every minute

## 18. Step-By-Step Build Plan

This is the order we should follow.

### Phase 0: Project foundation

1. Initialize `backend/` as Node.js + TypeScript project.
2. Add Fastify, Zod, Prisma, and test tooling.
3. Add `.env.example`.
4. Configure local PostgreSQL connection.
5. Add `GET /health`.
6. Add app bootstrapping and configuration loading.
7. Deploy the health-check skeleton to Railway immediately.

Definition of done:
- app starts locally
- health route works
- Prisma connects to local PostgreSQL
- Railway build, env, healthcheck, and Postgres connectivity are validated early

### Phase 1: Identity and users

1. Create Prisma schema for:
   - users
   - auth_identities
   - email_challenges
   - sessions
   - organizations
   - organization_members
   - devices
2. Create first migration.
3. Implement email OTP flow.
4. Implement Google sign-in.
5. Implement safe Google linking rules.
6. Implement refresh session flow.
7. Add OTP brute-force protection.
8. Return `GET /v1/me`.

Definition of done:
- a user can sign in from Android or Windows
- a user gets a personal organization
- session refresh works

### Phase 2: Preferences and device sync

1. Add:
   - user_preferences
   - dictionary_entries
   - writing_profiles
   - app_profiles
2. Add device registration endpoint.
3. Add device heartbeat endpoint.
4. Add preferences CRUD.
5. Add dictionary CRUD.
6. Add writing/app profile CRUD.

Definition of done:
- two devices on the same account can read the same preferences

### Phase 3: Stripe billing and entitlements

1. Add:
   - plans
   - provider_customers
   - subscriptions
   - entitlements
   - webhook_events
   - idempotency_keys
2. Seed `free`, `pro_monthly`, and `pro_yearly`.
3. Implement Stripe checkout session endpoint.
4. Implement Stripe customer portal endpoint.
5. Implement Stripe webhook verification from raw body.
6. Insert webhook rows before processing.
7. Implement webhook status state machine and retry logic.
8. Recompute entitlements after billing changes.
9. Add 30-day Pro trial logic.
10. Block duplicate paid checkout when active paid entitlement already exists.

Definition of done:
- Windows/web user can start trial or Pro
- entitlement route reflects correct access

### Phase 4: Google Play billing

1. Add `purchase_tokens`.
2. Implement Google Play verify route.
3. Implement Google Play restore route.
4. Implement RTDN endpoint.
5. Verify Google trust/auth data.
6. Insert RTDN rows durably.
7. Acknowledge initial purchases after secure verification.
8. Sync provider state.
9. Recompute entitlements.
10. Surface duplicate-subscription overlap when both Stripe and Google Play are active.

Definition of done:
- Android user subscription is recognized correctly
- entitlement route works for Google Play subscriptions too

### Phase 5: Usage and quota

1. Add:
   - realtime_sessions
   - quota_windows
   - usage_events
   - usage_rollups_weekly
2. Implement `POST /v1/realtime/session`.
3. Implement `POST /v1/usage/finalize`.
4. Implement atomic quota transaction.
5. Define UTC weekly window behavior.
6. Implement `GET /v1/usage/quota`.
7. Implement `GET /v1/usage/summary`.
8. Keep `POST /v1/usage/events` as telemetry only.

Definition of done:
- free weekly quota is enforced safely
- usage is visible in the API

### Phase 6: Security and production hardening

1. Add:
   - ip_observations
   - security_events
   - audit_logs
2. Add auth rate limiting.
3. Add raw-IP expiry behavior.
4. Add admin read-only endpoints.
5. Add logging and error tracking.
6. Review retention rules.

Definition of done:
- auth abuse is rate-limited
- security logs exist
- admin can inspect users, subscriptions, and usage

## 19. Release Gates

Internal infrastructure checkpoint:
- after Phase 0
- Railway deploy and Postgres connection verified

Internal auth checkpoint:
- after Phase 1
- account creation and refresh flow verified

Internal billing checkpoint:
- after Phase 4
- Stripe and Google Play both update entitlements correctly

Public launch checkpoint:
- after Phase 5
- hard quota enforcement is trusted and safe
- duplicate webhook retry path exists
- OTP brute-force protection exists
- duplicate subscription behavior is handled

## 20. What We Are Deliberately Deferring

These are useful, but not required before the first real backend launch:

- Redis
- Celery
- dedicated worker service
- advanced admin MFA workflows
- support impersonation sessions
- PostgreSQL RLS enforcement
- generated client SDKs
- outbox/dead-letter infrastructure
- monthly partitioning
- detailed cost-model appendix
- separate audio pipeline engineering document

## 21. Definition Of Success

This backend plan succeeds if TypeTalk can do all of the following:

- a user signs in on Android or Windows
- the same user account works across both platforms
- device and preference sync works
- Stripe billing works for Windows/web
- Google Play verification works for Android
- entitlements are unified behind one API
- weekly free-tier quota is enforced safely
- Railway deploy works from GitHub
- local PostgreSQL and Railway PostgreSQL both use the same Prisma schema
- raw audio and transcript text are not stored by default

## 22. Immediate Next Actions

Do these next:

1. Keep this file as the only active backend plan.
2. Use Node.js + Fastify + Prisma, not Python/Alembic.
3. Set up local PostgreSQL databases.
4. Scaffold the backend project in `backend/`.
5. Create the first Prisma schema and migration.
6. Implement auth first.
7. Then implement billing and entitlements.
8. Then implement usage and quota.
9. Then connect GitHub to Railway and deploy.

## 23. Reference Snapshot

This plan is based on the March 2026 product and platform snapshot already reviewed:

- Typeless product shape:
  - free weekly cap
  - Pro monthly/yearly
  - 30-day trial
  - zero-retention-by-default
- Railway deployment model:
  - app service + PostgreSQL service
  - private networking
  - healthchecks
  - backups
- Android billing:
  - Google Play verification + RTDN
- Web/Windows billing:
  - Stripe Checkout + Customer Portal
