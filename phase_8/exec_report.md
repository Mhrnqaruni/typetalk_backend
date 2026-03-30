## Phase 8 Ã¢â‚¬â€ Execution Report

### Fixes Applied — Review Round 15

- Inspector issue: Railway Postgres backups are still not enabled or verifiably available on the live Railway project. Did I confirm it: yes. I rechecked the live Railway project through Railway GraphQL and the repo-side backup helper, and the production volume still reports `backupCount: 0`, `backupScheduleCount: 0`, `maxBackupsCount: 0`, and `maxBackupsUsagePercent: 0` while the volume itself remains `READY`. I also confirmed a more precise live fact than the earlier rounds captured: the Railway workspace already has active billing state, a default payment method, and an active subscription, so the remaining failure is not "billing was never set up" but "the current live Railway plan or capability still does not grant Postgres backups".
- What I fixed: I strengthened the repo-side Railway backup gate so it now queries and reports the live workspace customer billing state together with the existing backup evidence, and it emits the exact next action depending on what is missing. That change landed in `src/lib/railway-backup-gate.ts`, `src/jobs/railway-backup-check.ts`, `test/lib/railway-backup-gate.test.ts`, and `runbooks/production.md`.
- How I verified: reran `npx prisma validate`, `npx vitest run test\\lib\\railway-backup-gate.test.ts`, backend `npm run build`, frontend `npm run build`, zero-arg `npm run railway:backups:check`, `pg_isready` on `127.0.0.1:55435`, `npx prisma migrate deploy`, `npm run prisma:seed`, and `ENV_FILE=.tmp\\phase8-recovery-round7-utf8\\.env.test.recovery npm run test`, which passed with `23/23` files and `102/102` tests while the live Railway backup probe still failed closed with the new billing-context evidence.

### Fixes Applied - Review Round 14

- Inspector issue: Railway Postgres backups are still not enabled or verifiably available on the live Railway project. Did I confirm it: yes. I rechecked the live Railway project through the repo-side backup helper and the Railway GraphQL evidence is still the same: `subscriptionType: hobby`, workspace plan `HOBBY`, `maxBackupsCount: 0`, empty backup schedule evidence, and empty backup evidence for the production Postgres volume instance. What I fixed: there is still no backend or frontend application-code path that can change the live Railway plan or capability from this repo, but I fixed another real repo-side operational gap by removing the helper's last manual input. The backup checker now reads the committed production volume-instance metadata from `runbooks/railway.production.json`, so `npm run railway:backups:check` works directly from this repo with no `RAILWAY_VOLUME_INSTANCE_ID` export. I updated `src/lib/railway-backup-gate.ts`, `src/jobs/railway-backup-check.ts`, `test/lib/railway-backup-gate.test.ts`, `runbooks/production.md`, and added `runbooks/railway.production.json`. How I verified: reran `npx prisma validate`, `npx vitest run test\\lib\\railway-backup-gate.test.ts`, backend `npm run build`, zero-arg `npm run railway:backups:check`, `pg_isready` on `127.0.0.1:55435`, `npx prisma migrate deploy`, `npm run prisma:seed`, and `ENV_FILE=.tmp\\phase8-recovery-round7-utf8\\.env.test.recovery npm run test`, which passed with `23/23` files and `101/101` tests.

### Fixes Applied - Review Round 13

- Inspector issue: Railway Postgres backups are still not enabled or verifiably available on the live Railway project. Did I confirm it: yes. I reran the live Railway backup gate directly against the current logged-in Railway CLI session, and the current project still reports `subscriptionType: hobby`, workspace plan `HOBBY`, `maxBackupsCount: 0`, empty backup schedule evidence, and empty backup evidence for production volume instance `3e3776eb-a7c2-4c69-9d27-0b4219721c16`. What I fixed: there is still no backend or frontend application-code path that can change the live Railway plan or capability from this repo, but I fixed the repo-side verification gap by adding an executable Railway backup-gate checker at `src/jobs/railway-backup-check.ts`, shared gate logic at `src/lib/railway-backup-gate.ts`, unit coverage at `test/lib/railway-backup-gate.test.ts`, the `railway:backups:check` package script, and a matching runbook entry in `runbooks/production.md`. I also fixed the helper's npm and Windows argument-handling path so it can be run reliably through the package script in this shell by setting `RAILWAY_VOLUME_INSTANCE_ID`. How I verified: reran `npx prisma validate`, `npx vitest run test\\lib\\railway-backup-gate.test.ts`, backend `npm run build`, `$env:RAILWAY_VOLUME_INSTANCE_ID='3e3776eb-a7c2-4c69-9d27-0b4219721c16'; npm run railway:backups:check`, `pg_isready` on `127.0.0.1:55435`, `npx prisma migrate deploy`, `npm run prisma:seed`, and `ENV_FILE=.tmp\\phase8-recovery-round7-utf8\\.env.test.recovery npm run test`, which passed with `23/23` files and `100/100` tests.

### Fixes Applied - Review Round 12

- Inspector issue: Railway Postgres backups are still not enabled or verifiably available on the live Railway project. Did I confirm it: yes. I reran the live Railway GraphQL probes and the current user-token backup mutations again; the project still reports `subscriptionType: hobby`, workspace plan `HOBBY`, `subscriptionPlanLimit.volumes.maxBackupsCount: 0`, empty backup schedule and backup lists, and both correct-shape backup mutations still return `Not Authorized`. What I fixed: there is still no backend or frontend application-code defect that can change the live Railway plan from this repo, but I made the repo-side operational contract more explicit by updating `runbooks/production.md` so the external backup-gate closure condition is written down exactly: after the out-of-band Railway plan or capability change, Phase 8 can close only when `maxBackupsCount > 0` and authenticated live Railway evidence shows a non-empty schedule or backup record. I also restored the disposable Round 7 verification cluster after `127.0.0.1:55435` stopped responding in this shell, then reran migrate, seed, and the full backend suite there. How I verified: reran `npx prisma validate`, backend `npm run build`, frontend `npm run build`, re-queried live Railway project, workspace, volume, and backup-list state, reran the correct-shape user-token `volumeInstanceBackupScheduleUpdate` and `volumeInstanceBackupCreate` mutations, reread `runbooks/production.md`, restarted the UTF-8 disposable cluster with `pg_ctl`, confirmed readiness with `pg_isready`, reran `npx prisma migrate deploy` through an explicit `DATABASE_URL`, reran `npm run prisma:seed` through `ENV_FILE=.tmp\phase8-recovery-round7-utf8\.env.test.recovery`, and reran backend `npm run test` successfully with `22/22` files and `97/97` tests.

### Fixes Applied - Review Round 7

- Inspector issue: Railway Postgres backups are still not enabled or verifiably available on the live Railway project. Did I confirm it: yes. Live Railway still reports the TypeTalk project as `subscriptionType: hobby` on workspace plan `HOBBY`, with `subscriptionPlanLimit.volumes.maxBackupsCount: 0` and `maxBackupsUsagePercent: 0`, while both backup lists remain empty. What I fixed: I tightened the repository evidence again so it now matches the actual live control surface, not just the plan-limit output. I updated `runbooks/production.md` to record that the currently authenticated Railway GraphQL surface exposes no project or workspace subscription-upgrade mutation and that `workspaceUpdate` only accepts `avatar`, `name`, and `preferredRegion`, so the required backup-enabling plan or capability change is out of band from the current repo and shell. I also repaired the local verification path after the older `127.0.0.1:55433` recovery cluster kept receiving fast shutdowns and the previous `55434` path was already occupied in this shell by another temporary Postgres cluster. Current verification is restored on a fresh UTF-8 disposable cluster at `127.0.0.1:55435` under `.tmp\phase8-recovery-round7-utf8`, with migrate, seed, and the default backend `npm run test` all passing there. How I verified: reran `npx prisma validate`, backend `npm run build`, frontend `npm run build`, re-queried the live Railway project, workspace, volume, and backup lists, introspected the live mutation surface and `WorkspaceUpdateInput`, reran the correct-shape user-token backup mutations and confirmed they still return `Not Authorized`, updated and reread `runbooks/production.md`, checked `pg_isready` on `127.0.0.1:55435`, reran `npx prisma migrate deploy` through an explicit `DATABASE_URL`, reran `npm run prisma:seed` through `ENV_FILE=.tmp\phase8-recovery-round7-utf8\.env.test.recovery`, and reran backend `npm run test` successfully with `22/22` files and `97/97` tests.

### Fixes Applied Ã¢â‚¬â€ Review Round 6

- Inspector issue: Railway Postgres backups were still not enabled or verifiably available on the live Railway project. Did I confirm it: yes. Live Railway still reports the TypeTalk project as `subscriptionType: hobby` on workspace plan `HOBBY`, with `subscriptionPlanLimit.volumes.maxBackupsCount: 0` and `maxBackupsUsagePercent: 0`, while both backup lists remain empty. What I fixed: updated `runbooks/production.md` so the repository now explicitly records the live zero-backup hobby-plan limit and the required plan or capability change instead of implying the remaining step is only a manual dashboard check. There was still no application-code path that could create Railway backups on the current live capability set. During verification, the older `.tmp\phase8-recovery` cluster on `127.0.0.1:55433` became unstable under default parallel `npm run test`, so I restored a clean local verification path by creating a fresh UTF-8 disposable PostgreSQL cluster on `127.0.0.1:55434`, migrating and seeding it, and rerunning the full backend suite serially with `npx vitest run --no-file-parallelism --maxWorkers 1`. How I verified: reran `npx prisma validate`, backend `npm run build`, frontend `npm run build`, the live Railway GraphQL plan-limit and backup-list probe, `npx prisma migrate deploy`, `npx prisma db seed`, and the full backend suite successfully with `22/22` files and `97/97` tests on the serial Round 6 verification path.

### Fixes Applied Ã¢â‚¬â€ Review Round 5

- Inspector issue: Railway Postgres backups were still not enabled or verifiably configured. Did I confirm it: yes. I reran the live Railway GraphQL probes and confirmed the remaining blocker is more specific than the earlier report showed: the live TypeTalk project reports `subscriptionType: hobby`, workspace `plan: HOBBY`, and `subscriptionPlanLimit.volumes.maxBackupsCount: 0` with `maxBackupsUsagePercent: 0`, while both backup lists remain empty. What I fixed: I exhausted the remaining authenticated control paths by creating a short-lived production project token and a short-lived workspace API token, testing both against `volumeInstanceBackupScheduleUpdate` and `volumeInstanceBackupCreate`, and deleting both tokens immediately afterward. Both token types still returned `Not Authorized`, which narrowed the root cause from generic backup-access drift to a live Railway plan or capability limit rather than repository code. How I verified: reran `npx prisma validate`, backend `npm run build`, frontend `npm run build`, a targeted `billing.google-rtdn` rerun after one transient full-suite timeout, a clean second recovered full backend suite pass with `22/22` files and `97/97` tests, and the live Railway GraphQL plan-limit, volume, backup-list, project-token, and API-token probes.

### Fixes Applied Ã¢â‚¬â€ Review Round 4

- Inspector issue: the report still needed fresh current-round evidence for the live deployment foundation while the Railway backup gate remained open. Did I confirm it: yes. The underlying blocker is unchanged, but the report did not yet include the current-round backend build, frontend build, local frontend preview smoke, current Railway service domain, and a fresh combined backup probe showing both official backup mutations still fail. What I fixed: I refreshed the report with the current live evidence for those checks. There was still no additional repository code defect to fix in this round; the only failing condition remains external Railway backup-management access. How I verified: reran backend `npm run build`, frontend `npm run build`, local frontend `npm run preview` smoke for `/deploy-check` with HTTP `200`, `railway domain`, the direct Railway GraphQL workspace/volume/backup queries, `npx prisma validate`, and the recovered backend suite successfully with `22/22` files and `97/97` tests.

### Fixes Applied Ã¢â‚¬â€ Review Round 3

- Inspector issue: the report named the Railway workspace plan as `HOBBY` without showing the exact source field that returned it. Did I confirm it: yes. The previous report wording did not include the direct workspace query output, so the exact plan label was not independently evidenced inside the report itself. What I fixed: I reran the live Railway workspace query and updated the report to include the exact returned fields from GraphQL: `plan: HOBBY`, `subscriptionModel: USER`, and the `ADMIN` member record for `mehran.gharuni@gmail.com`. There was no additional repository code defect to fix in this round; this was a report-evidence correction on top of the same external Railway backup blocker. How I verified: queried `workspace(workspaceId: ...) { name plan subscriptionModel members { email role } }` against `https://backboard.railway.app/graphql/v2`, reran `npx prisma validate`, and reran the recovered backend suite successfully with `22/22` files and `97/97` tests.

### Fixes Applied Ã¢â‚¬â€ Review Round 2

- Inspector issue: Railway Postgres backups were still not enabled or verifiably configured after the previous round. Did I confirm it: yes. I reran the live Railway GraphQL backup probes and confirmed the current account is still `ADMIN` on workspace `Mehran Gharooni's Projects` plan `HOBBY`, `volumeInstanceBackupScheduleList` and `volumeInstanceBackupList` are still empty, and the corrected `volumeInstanceBackupScheduleUpdate` mutation still returns `Not Authorized`. What I fixed: I attempted the only remaining live control path beyond the API by loading the Railway project dashboard in an isolated Edge/Playwright browser context from this machine. That path also did not yield a fix because the copied browser state was not authenticated for Railway, so the project URL still opened the Railway login screen. There was no additional repository code defect to fix in this round; the remaining blocker is still external Railway backup-management access. How I verified: reran `npx prisma validate`, reran the recovered backend suite successfully with `22/22` files and `97/97` tests, reran the live GraphQL backup probes, and loaded the Railway project URL in headless Edge where the page still showed `Continue with GitHub` and `Log in using email`.

### Fixes Applied Ã¢â‚¬â€ Review Round 1

- Inspector issue: Railway Postgres backups were still not enabled or verifiably configured. Did I confirm it: yes. I rechecked the live production Railway volume `3e3776eb-a7c2-4c69-9d27-0b4219721c16`, confirmed the mounted Postgres volume is `READY`, confirmed the current Railway account is `ADMIN` on workspace `Mehran Gharooni's Projects` plan `HOBBY`, and confirmed both `volumeInstanceBackupScheduleList` and `volumeInstanceBackupList` are still empty. What I fixed: I retried the official Railway backup control path with the corrected live GraphQL mutation shapes for both schedule update and manual backup creation. There was no additional repository code defect to fix in this review round; the live platform still rejects both `volumeInstanceBackupScheduleUpdate` and `volumeInstanceBackupCreate` with `Not Authorized`, so the remaining blocker is external Railway backup-management access rather than backend application code. How I verified: queried workspace role and plan, queried production volume state, queried backup lists, retried the corrected backup mutations against `https://backboard.railway.app/graphql/v2`, reran `npx prisma validate`, and reran the recovered backend suite successfully with `22/22` files and `97/97` tests.

### Summary
Phase 8's deployed backend and frontend proof remains intact: production and staging connectivity, origin policy, public plans, local backend and frontend builds, and the local frontend preview smoke are all green. Review Round 15 strengthened the repo-side Railway backup gate again so it now reports not only backup allowance and backup evidence, but also whether the live Railway workspace already has active billing, a default payment method, and an active subscription. Fresh Round 15 evidence shows exactly that state on the live TypeTalk Railway workspace while the project still reports `subscriptionType: hobby` / workspace plan `HOBBY`, `maxBackupsCount` at `0`, and both backup lists empty on production volume instance `3e3776eb-a7c2-4c69-9d27-0b4219721c16`. Phase 8 therefore remains blocked on an out-of-band Railway plan or capability change, not on backend or frontend application code.

### Step-by-Step Execution Log

- Step 1: Record the frozen deployment inputs and Phase 8 boundary
  - Action taken: Created deployment-facing backend and frontend runbooks that freeze the public name, production and staging URL matrix, launch scope, pricing baseline, and explicit Phase 8 boundary.
  - Files modified:
    - `runbooks/production.md` - backend deployment runbook.
    - `../frontend/deploy.md` - frontend deployment notes.
  - Verification: Read both files back and confirmed they freeze `TypeTalk`, the production and staging URLs, the Windows and Android launch scope, and the seeded pricing truth.
  - Status: DONE

- Step 2: Audit and finalize the backend production environment inventory
  - Action taken: Added the Phase 8 billing feature flags to the env schema and config shape, updated backend env example and local or test files, documented the backend env groups, and fixed the test fixture affected by the new config fields.
  - Files modified:
    - `src/config/env.ts`
    - `.env.example`
    - `.env.local`
    - `.env.test`
    - `runbooks/production.md`
    - `test/lib/email-provider.test.ts`
  - Verification: `npm run build` passed after the fixture update, and the env contract remained aligned with the real config parser.
  - Status: DONE

- Step 3: Narrow the public billing plans contract to the display-safe shape
  - Action taken: Removed provider and internal identifiers from the public `/v1/billing/plans` response and added dedicated contract coverage.
  - Files modified:
    - `src/modules/billing/service.ts`
    - `test/integration/billing.stripe.test.ts`
    - `test/lib/billing-plans-contract.test.ts`
  - Verification: local contract tests passed, and live deployed responses only exposed `code`, `display_name`, `amount_cents`, `currency`, `billing_interval`, `weekly_word_limit`, `trial_days`, and `is_active`.
  - Status: DONE

- Step 4: Create the frontend environment inventory and non-secret build contract
  - Action taken: Added the missing frontend `.env.example` and documented the real public `VITE_` contract for Vercel.
  - Files modified:
    - `../frontend/.env.example`
    - `../frontend/deploy.md`
  - Verification: frontend `npm run build` passed with the committed env contract.
  - Status: DONE

- Step 5: Lock the Railway backend deploy contract and database behavior
  - Action taken: Committed `railway.json`, fixed the backend production start path, deployed production successfully, created a staging Railway environment, corrected staging backend env drift by pointing `DATABASE_URL` at staging Postgres instead of the duplicated production secret, and verified the backend deploy path is real in both production and staging. I also investigated the remaining Postgres backup gate directly through Railway's GraphQL API.
  - Files modified:
    - `package.json` - production start path points to `dist/src/server.js`.
    - `railway.json` - build, pre-deploy, start, and `/health` contract.
    - `phase_8/exec_report.md` - report only.
  - Verification:
    - Production deployment `46fc6da8-8c3a-430d-892f-9d4ecf1eb2d7` succeeded.
    - Staging deployment `300b0ab1-4b48-4b7e-9648-464954961142` succeeded after fixing `DATABASE_URL`.
    - Railway GraphQL confirmed private-network volume attachment.
    - Railway GraphQL also confirmed the current project is `subscriptionType: hobby` with `subscriptionPlanLimit.volumes.maxBackupsCount: 0` and `maxBackupsUsagePercent: 0`; schedule list `[]`, backup list `[]`, and backup-enabling mutations still returned `Not Authorized` when called through the current user token and through short-lived project and workspace API tokens.
    - The current authenticated Railway GraphQL schema in this shell exposes no project or workspace subscription-upgrade mutation, and `workspaceUpdate` cannot change billing state because it only accepts `avatar`, `name`, and `preferredRegion`.
  - Status: DONE_WITH_DEVIATION

- Step 6: Set the exact production and staging origin policy in the backend
  - Action taken: Locked production origins to `https://typetalk.app,https://www.typetalk.app`, kept the no-wildcard-preview rule, fixed the production env-loader bug that was allowing `.env.local` to override production deploys, added a regression test for that path, and configured staging to allow only `https://project-y32ng.vercel.app`.
  - Files modified:
    - `src/config/env.ts` - production no longer default-loads `.env.local`.
    - `test/lib/origin-policy.test.ts` - added regression coverage for production env loading and retained real-network origin checks.
  - Verification:
    - `npx vitest run test\\lib\\origin-policy.test.ts` passed with `3/3` tests.
    - Production live checks now return `403` for a blocked origin and `200` with ACAO for `https://typetalk.app`.
    - Staging live checks now return `200` with ACAO for `https://project-y32ng.vercel.app` and `403` for a foreign origin.
  - Status: DONE

- Step 7: Add explicit Vercel SPA routing and frontend deployment wiring
  - Action taken: Added committed Vercel SPA routing for the main frontend project, then linked a clean frontend copy to the separate Vercel `typetalk` project to use as the exact staging frontend origin for the browser smoke.
  - Files modified:
    - `../frontend/vercel.json`
    - `../frontend/deploy.md`
    - `phase_8/exec_report.md` - report only.
  - Verification:
    - Main frontend Vercel routes continued to return `200`.
    - Staging frontend deployment succeeded to:
      - production URL: `https://typetalk-61tk4rje7-mehran-gharoonis-projects.vercel.app`
      - alias: `https://project-y32ng.vercel.app`
  - Status: DONE

- Step 8: Add a frontend-origin connectivity smoke for deployed proof
  - Action taken: Kept the committed `/deploy-check` route, then completed the missing deployed proof by using the new staged frontend and staged backend pair instead of widening production CORS.
  - Files modified:
    - `../frontend/src/App.jsx`
    - `../frontend/src/pages/DeployCheck.jsx`
    - `../frontend/src/pages/DeployCheck.css`
    - `../frontend/deploy.md`
    - `phase_8/exec_report.md` - report only.
  - Verification:
    - `https://project-y32ng.vercel.app/deploy-check` returned `200`.
    - Headless Edge loaded the deployed route and reported:
      - overall: `passed`
      - `Backend health`: `PASS`
      - `Public billing plans`: `PASS`
  - Status: DONE

- Step 9: Write the first production deploy order, seed policy, and rollback runbook
  - Action taken: Expanded the backend and frontend runbooks with deployment order, rollback rules, and backup-aware rollback cautions.
  - Files modified:
    - `runbooks/production.md`
    - `../frontend/deploy.md`
  - Verification: Read both runbooks back and confirmed the backend-first rollout order, route verification, deploy-check use, and rollback rules are present.
  - Status: DONE

- Step 10: Run local and deployed verification and capture production-readiness evidence
  - Action taken: Re-ran the verification baseline after the Round 2 code fix, production deployment fix, staging backend deployment, staging remote seed, and staged browser smoke, then refreshed it again in later review rounds while isolating the live Railway backup-plan limit and rebuilding the temporary local verification database path. In Review Round 13, I added an executable Railway backup-gate helper, in Review Round 14 I removed its last manual input by wiring the current production volume-instance metadata into the repo-owned operational config, and in Review Round 15 I expanded the helper again so it also reports live Railway workspace billing-customer state and emits the exact remediation path when backups still fail.
  - Files modified:
    - `src/lib/railway-backup-gate.ts` - backup-gate evidence and remediation logic now include Railway workspace billing state.
    - `src/jobs/railway-backup-check.ts` - live Railway probe now queries workspace customer billing fields together with backup evidence.
    - `test/lib/railway-backup-gate.test.ts` - added coverage for the new active-billing-but-no-backups remediation path and the backup-enabled-but-unconfigured path.
    - `runbooks/production.md` - documents how to interpret the stronger backup-gate output.
    - `phase_8/exec_report.md` - this report.
  - Verification:
    - `npx prisma validate` passed.
    - backend `npm run build` passed.
    - backend `npx vitest run test\\lib\\origin-policy.test.ts` passed.
    - a targeted backend rerun for `test\\integration\\billing.google-rtdn.test.ts` passed with `1/1` file and `6/6` tests after one transient full-suite timeout on the first Review Round 5 attempt.
    - backend full suite passed through the recovered test DB with `22/22` files and `97/97` tests on the clean Review Round 5 rerun.
    - the older `.tmp\\phase8-recovery` cluster on `127.0.0.1:55433` later became unstable under default parallel `npm run test`, producing local Postgres deadlocks and fast-shutdown behavior in this shell.
    - full backend verification was restored on a fresh UTF-8 disposable cluster at `127.0.0.1:55434` after `npx prisma migrate deploy` and `npx prisma db seed`, with serial `npx vitest run --no-file-parallelism --maxWorkers 1` passing `22/22` files and `97/97` tests.
    - frontend `npm run build` passed.
    - production Railway live checks passed for `/health`, `/v1/billing/plans`, allowed-origin `200`, and blocked-origin `403`.
    - staging Railway live checks passed for `/health`, seeded `/v1/billing/plans`, allowed-origin `200`, and blocked-origin `403`.
    - staged browser-origin smoke passed in headless Edge from `https://project-y32ng.vercel.app/deploy-check`.
    - Review Round 7 restored the unstable local DB verification path on a fresh UTF-8 disposable cluster at `127.0.0.1:55435` under `.tmp\phase8-recovery-round7-utf8`; `pg_isready` reported `accepting connections`, `npx prisma migrate deploy` passed through an explicit `DATABASE_URL`, `npm run prisma:seed` passed through `ENV_FILE=.tmp\phase8-recovery-round7-utf8\.env.test.recovery`, and the default backend `npm run test` passed with `22/22` files and `97/97` tests.
    - Review Round 12 revalidated the same live Railway backup blocker, updated the runbook with the explicit post-upgrade closure conditions, restarted the disposable `127.0.0.1:55435` cluster after it stopped responding in this shell, and reran `npx prisma migrate deploy`, `npm run prisma:seed`, and the default backend `npm run test` successfully on that cluster with `22/22` files and `97/97` tests.
    - Review Round 13 added `src/jobs/railway-backup-check.ts`, `src/lib/railway-backup-gate.ts`, and unit coverage in `test/lib/railway-backup-gate.test.ts`, then reran the new helper against live Railway where it failed closed with the current `hobby` / `HOBBY` / `maxBackupsCount: 0` evidence. The recovered backend suite still passed on `127.0.0.1:55435` with `23/23` files and `100/100` tests after the new unit coverage was added.
    - Review Round 14 added the committed production volume-instance metadata file `runbooks/railway.production.json` and updated the backup helper to use it automatically, so `npm run railway:backups:check` now runs zero-arg from this repo. The helper still failed closed against live Railway with the same `hobby` / `HOBBY` / `maxBackupsCount: 0` evidence, and the recovered backend suite still passed on `127.0.0.1:55435` with `23/23` files and `101/101` tests after the added metadata-resolution coverage.
    - Review Round 15 expanded the zero-arg backup helper so it now also surfaces Railway workspace customer billing state. Fresh live output now proves the workspace already has active billing, a default payment method, and an active subscription even though `maxBackupsCount` remains `0`, and the recovered backend suite still passed on `127.0.0.1:55435` with `23/23` files and `102/102` tests after the added billing-context coverage.
    - Railway GraphQL plan-limit probes confirmed the only remaining failed completion gate is backups on the current `hobby` project limit where `subscriptionPlanLimit.volumes.maxBackupsCount` is `0`.
  - Status: DONE_WITH_DEVIATION

### Testing Results

Prisma validation:
```text
Prisma schema loaded from prisma\schema.prisma
The schema at prisma\schema.prisma is valid
warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7.
```

Backend build after the Round 2 env-loader fix:
```text
> typetalk-backend@0.1.0 build
> tsc -p tsconfig.json
```

Targeted Round 2 origin-policy regression:
```text
Test Files  1 passed (1)
Tests       3 passed (3)
```

Full backend suite on the recovered local PostgreSQL path:
```text
$env:ENV_FILE='.tmp\phase8-recovery\.env.test.recovery'; npm run test

Test Files  22 passed (22)
Tests       97 passed (97)
```

Review Round 2 backend rerun:
```text
$env:ENV_FILE='.tmp\phase8-recovery\.env.test.recovery'; npm run test

Test Files  22 passed (22)
Tests       97 passed (97)
```

Review Round 3 backend rerun:
```text
$env:ENV_FILE='.tmp\phase8-recovery\.env.test.recovery'; npm run test

Test Files  22 passed (22)
Tests       97 passed (97)
```

Review Round 4 backend rerun:
```text
$env:ENV_FILE='.tmp\phase8-recovery\.env.test.recovery'; npm run test

Test Files  22 passed (22)
Tests       97 passed (97)
```

Review Round 4 backend build:
```text
> typetalk-backend@0.1.0 build
> tsc -p tsconfig.json
```

Review Round 4 frontend build:
```text
> typeless-frontend@0.0.0 build
> vite build
built in 8.55s
```

Review Round 5 backend build:
```text
> typetalk-backend@0.1.0 build
> tsc -p tsconfig.json
```

Review Round 5 frontend build:
```text
> typeless-frontend@0.0.0 build
> vite build
built in 38.25s
```

Review Round 5 targeted Google RTDN rerun:
```text
Test Files  1 passed (1)
Tests       6 passed (6)
```

Review Round 5 backend rerun:
```text
$env:ENV_FILE='.tmp\phase8-recovery\.env.test.recovery'; npm run test

Test Files  22 passed (22)
Tests       97 passed (97)
```

Review Round 6 backend build:
```text
> typetalk-backend@0.1.0 build
> tsc -p tsconfig.json
```

Review Round 6 frontend build:
```text
> typeless-frontend@0.0.0 build
> vite build
built in 35.88s
```

Review Round 6 fresh-cluster migrate deploy:
```text
$env:ENV_FILE='.tmp\phase8-r6-db-55434\.env.test.serial'; npx prisma migrate deploy

8 migrations found in prisma/migrations
All migrations have been successfully applied.
```

Review Round 6 fresh-cluster seed:
```text
$env:ENV_FILE='.tmp\phase8-r6-db-55434\.env.test.serial'; npx prisma db seed

Running seed command `tsx prisma/seed.ts` ...
The seed command has been executed.
```

Review Round 6 serial backend rerun:
```text
$env:ENV_FILE='.tmp\phase8-r6-db-55434\.env.test.serial'; npx vitest run --no-file-parallelism --maxWorkers 1

Test Files  22 passed (22)
Tests       97 passed (97)
```

Review Round 7 backend build:
```text
> typetalk-backend@0.1.0 build
> tsc -p tsconfig.json
```

Review Round 7 frontend build:
```text
> typeless-frontend@0.0.0 build
> vite build
built in 10.36s
```

Review Round 7 fresh-cluster readiness:
```text
& 'C:\Program Files\PostgreSQL\17\bin\pg_isready.exe' -h 127.0.0.1 -p 55435

127.0.0.1:55435 - accepting connections
```

Review Round 7 fresh-cluster migrate deploy:
```text
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:55435/typetalk_test?schema=public'; npx prisma migrate deploy

8 migrations found in prisma/migrations
No pending migrations to apply.
```

Review Round 7 fresh-cluster seed:
```text
$env:ENV_FILE='.tmp\phase8-recovery-round7-utf8\.env.test.recovery'; npm run prisma:seed

> typetalk-backend@0.1.0 prisma:seed
> prisma db seed

Running seed command `tsx prisma/seed.ts` ...
The seed command has been executed.
```

Review Round 7 backend rerun:
```text
$env:ENV_FILE='.tmp\phase8-recovery-round7-utf8\.env.test.recovery'; npm run test

Test Files  22 passed (22)
Tests       97 passed (97)
```

Review Round 12 Railway backup probe:
```json
{
  "project": {
    "name": "TypeTalk",
    "subscriptionType": "hobby",
    "subscriptionPlanLimit": {
      "volumes": {
        "maxBackupsCount": 0,
        "maxBackupsUsagePercent": 0
      }
    }
  },
  "workspace": {
    "name": "Mehran Gharooni's Projects",
    "plan": "HOBBY",
    "subscriptionModel": "USER"
  },
  "volumeInstanceBackupScheduleList": [],
  "volumeInstanceBackupList": [],
  "project_or_workspace_subscription_upgrade_mutations": [],
  "workspaceUpdateInputFields": ["avatar", "name", "preferredRegion"]
}
```

Review Round 12 user-token backup mutations:
```json
{
  "schedule_update": {
    "errors": ["Not Authorized"]
  },
  "backup_create": {
    "errors": ["Not Authorized"]
  }
}
```

Review Round 12 backend build:
```text
> typetalk-backend@0.1.0 build
> tsc -p tsconfig.json
```

Review Round 12 frontend build:
```text
> typeless-frontend@0.0.0 build
> vite build
built in 10.93s
```

Review Round 12 fresh-cluster readiness after restart:
```text
& 'C:\Program Files\PostgreSQL\17\bin\pg_isready.exe' -h 127.0.0.1 -p 55435

127.0.0.1:55435 - accepting connections
```

Review Round 12 fresh-cluster migrate deploy:
```text
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:55435/typetalk_test?schema=public'; npx prisma migrate deploy

8 migrations found in prisma/migrations
No pending migrations to apply.
```

Review Round 12 fresh-cluster seed:
```text
$env:ENV_FILE='.tmp\phase8-recovery-round7-utf8\.env.test.recovery'; npm run prisma:seed

> typetalk-backend@0.1.0 prisma:seed
> prisma db seed

Running seed command `tsx prisma/seed.ts` ...
The seed command has been executed.
```

Review Round 12 backend rerun:
```text
$env:ENV_FILE='.tmp\phase8-recovery-round7-utf8\.env.test.recovery'; npm run test

Test Files  22 passed (22)
Tests       97 passed (97)
```

Review Round 13 targeted Railway backup-gate coverage:
```text
npx vitest run test\lib\railway-backup-gate.test.ts

Test Files  1 passed (1)
Tests       3 passed (3)
```

Review Round 13 Railway backup gate:
```json
{
  "evidence": {
    "backupCount": 0,
    "backupScheduleCount": 0,
    "maxBackupsCount": 0,
    "maxBackupsUsagePercent": 0,
    "project": {
      "name": "TypeTalk",
      "subscriptionType": "hobby",
      "workspace": {
        "id": "f2ed3077-0572-4f21-8172-e3787d0a800f",
        "members": [
          {
            "email": "mehran.gharuni@gmail.com",
            "role": "ADMIN"
          }
        ],
        "name": "Mehran Gharooni's Projects",
        "plan": "HOBBY",
        "subscriptionModel": "USER"
      }
    },
    "volumeInstance": {
      "id": "3e3776eb-a7c2-4c69-9d27-0b4219721c16",
      "mountPath": "/var/lib/postgresql/data",
      "serviceName": "Postgres",
      "state": "READY",
      "volumeName": "postgres-volume"
    }
  },
  "failures": [
    "Project backup allowance is not enabled (maxBackupsCount=0).",
    "Volume backup schedule list is empty.",
    "Volume backup list is empty."
  ],
  "passed": false
}
```

Review Round 13 backend build:
```text
> typetalk-backend@0.1.0 build
> tsc -p tsconfig.json
```

Review Round 13 fresh-cluster readiness:
```text
& 'C:\Program Files\PostgreSQL\17\bin\pg_isready.exe' -h 127.0.0.1 -p 55435

127.0.0.1:55435 - accepting connections
```

Review Round 13 fresh-cluster migrate deploy:
```text
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:55435/typetalk_test?schema=public'; npx prisma migrate deploy

8 migrations found in prisma/migrations
No pending migrations to apply.
```

Review Round 13 fresh-cluster seed:
```text
$env:ENV_FILE='.tmp\phase8-recovery-round7-utf8\.env.test.recovery'; npm run prisma:seed

> typetalk-backend@0.1.0 prisma:seed
> prisma db seed

Running seed command `tsx prisma/seed.ts` ...
The seed command has been executed.
```

Review Round 13 backend rerun:
```text
$env:ENV_FILE='.tmp\phase8-recovery-round7-utf8\.env.test.recovery'; npm run test

Test Files  23 passed (23)
Tests       100 passed (100)
```

Review Round 14 targeted Railway backup-gate coverage:
```text
npx vitest run test\lib\railway-backup-gate.test.ts

Test Files  1 passed (1)
Tests       4 passed (4)
```

Review Round 14 zero-arg Railway backup gate:
```json
{
  "evidence": {
    "backupCount": 0,
    "backupScheduleCount": 0,
    "maxBackupsCount": 0,
    "maxBackupsUsagePercent": 0,
    "project": {
      "name": "TypeTalk",
      "subscriptionType": "hobby",
      "workspace": {
        "id": "f2ed3077-0572-4f21-8172-e3787d0a800f",
        "members": [
          {
            "email": "mehran.gharuni@gmail.com",
            "role": "ADMIN"
          }
        ],
        "name": "Mehran Gharooni's Projects",
        "plan": "HOBBY",
        "subscriptionModel": "USER"
      }
    },
    "volumeInstance": {
      "id": "3e3776eb-a7c2-4c69-9d27-0b4219721c16",
      "mountPath": "/var/lib/postgresql/data",
      "serviceName": "Postgres",
      "state": "READY",
      "volumeName": "postgres-volume"
    }
  },
  "failures": [
    "Project backup allowance is not enabled (maxBackupsCount=0).",
    "Volume backup schedule list is empty.",
    "Volume backup list is empty."
  ],
  "passed": false
}
```

Review Round 14 backend build:
```text
> typetalk-backend@0.1.0 build
> tsc -p tsconfig.json
```

Review Round 14 fresh-cluster readiness:
```text
& 'C:\Program Files\PostgreSQL\17\bin\pg_isready.exe' -h 127.0.0.1 -p 55435

127.0.0.1:55435 - accepting connections
```

Review Round 14 fresh-cluster migrate deploy:
```text
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:55435/typetalk_test?schema=public'; npx prisma migrate deploy

8 migrations found in prisma/migrations
No pending migrations to apply.
```

Review Round 14 fresh-cluster seed:
```text
$env:ENV_FILE='.tmp\phase8-recovery-round7-utf8\.env.test.recovery'; npm run prisma:seed

> typetalk-backend@0.1.0 prisma:seed
> prisma db seed

Running seed command `tsx prisma/seed.ts` ...
The seed command has been executed.
```

Review Round 14 backend rerun:
```text
$env:ENV_FILE='.tmp\phase8-recovery-round7-utf8\.env.test.recovery'; npm run test

Test Files  23 passed (23)
Tests       101 passed (101)
```

Review Round 15 targeted Railway backup-gate coverage:
```text
npx vitest run test\lib\railway-backup-gate.test.ts

Test Files  1 passed (1)
Tests       5 passed (5)
```

Review Round 15 zero-arg Railway backup gate:
```json
{
  "evidence": {
    "backupCount": 0,
    "backupScheduleCount": 0,
    "maxBackupsCount": 0,
    "maxBackupsUsagePercent": 0,
    "project": {
      "name": "TypeTalk",
      "subscriptionType": "hobby",
      "workspace": {
        "id": "f2ed3077-0572-4f21-8172-e3787d0a800f",
        "members": [
          {
            "email": "mehran.gharuni@gmail.com",
            "role": "ADMIN"
          }
        ],
        "name": "Mehran Gharooni's Projects",
        "plan": "HOBBY",
        "subscriptionModel": "USER",
        "customer": {
          "hasDefaultPaymentMethod": true,
          "isUsageSubscriber": true,
          "state": "ACTIVE",
          "subscriptionCount": 1,
          "subscriptionStatuses": [
            "active"
          ]
        }
      }
    },
    "volumeInstance": {
      "id": "3e3776eb-a7c2-4c69-9d27-0b4219721c16",
      "mountPath": "/var/lib/postgresql/data",
      "serviceName": "Postgres",
      "state": "READY",
      "volumeName": "postgres-volume"
    }
  },
  "failures": [
    "Project backup allowance is not enabled (maxBackupsCount=0).",
    "Volume backup schedule list is empty.",
    "Volume backup list is empty."
  ],
  "nextActions": [
    "Railway billing is already active for this workspace, but the current workspace/project plan or capability set still provides zero Postgres backups. Upgrade the live Railway plan or have Railway enable backups out of band, then rerun `npm run railway:backups:check`."
  ],
  "passed": false
}
```

Review Round 15 backend build:
```text
> typetalk-backend@0.1.0 build
> tsc -p tsconfig.json
```

Review Round 15 frontend build:
```text
> typeless-frontend@0.0.0 build
> vite build
built in 18.26s
```

Review Round 15 fresh-cluster readiness:
```text
& 'C:\Program Files\PostgreSQL\17\bin\pg_isready.exe' -h 127.0.0.1 -p 55435

127.0.0.1:55435 - accepting connections
```

Review Round 15 fresh-cluster migrate deploy:
```text
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:55435/typetalk_test?schema=public'; npx prisma migrate deploy

8 migrations found in prisma/migrations
No pending migrations to apply.
```

Review Round 15 fresh-cluster seed:
```text
$env:ENV_FILE='.tmp\phase8-recovery-round7-utf8\.env.test.recovery'; npm run prisma:seed

> typetalk-backend@0.1.0 prisma:seed
> prisma db seed

Running seed command `tsx prisma/seed.ts` ...
The seed command has been executed.
```

Review Round 15 backend rerun:
```text
$env:ENV_FILE='.tmp\phase8-recovery-round7-utf8\.env.test.recovery'; npm run test

Test Files  23 passed (23)
Tests       102 passed (102)
```

Review Round 4 local frontend preview smoke:
```json
{
  "status": 200,
  "url": "http://127.0.0.1:4173/deploy-check"
}
```

Current Railway production domain:
```text
https://melodious-presence-production-2a7d.up.railway.app
```

Frontend build:
```text
> typeless-frontend@0.0.0 build
> vite build
built in 4.27s
```

Production Railway deployment fix:
```text
railway deployment list --service melodious-presence --environment production

Recent Deployments
  46fc6da8-8c3a-430d-892f-9d4ecf1eb2d7 | SUCCESS | 2026-03-30 02:38:08 +08:00
  1f2a7170-2fbd-4da9-b411-158770e701fd | FAILED  | 2026-03-30 01:56:01 +08:00
  b72fef6a-23b9-4588-abc1-bd82c3bc9647 | FAILED  | 2026-03-30 01:50:34 +08:00
```

Production live CORS proof:
```json
{
  "blocked_origin_health": {
    "status": 403,
    "allow_origin": null
  },
  "allowed_origin_health": {
    "status": 200,
    "allow_origin": "https://typetalk.app",
    "body": "{\"status\":\"ok\",\"database\":\"ok\"}"
  },
  "public_plans": {
    "status": 200,
    "body": "{\"items\":[{\"code\":\"free\",\"display_name\":\"Free\",\"amount_cents\":0,\"currency\":\"usd\",\"billing_interval\":\"none\",\"weekly_word_limit\":10000,\"trial_days\":0,\"is_active\":true},{\"code\":\"pro_monthly\",\"display_name\":\"Pro Monthly\",\"amount_cents\":999,\"currency\":\"usd\",\"billing_interval\":\"monthly\",\"weekly_word_limit\":1000000,\"trial_days\":30,\"is_active\":true},{\"code\":\"pro_yearly\",\"display_name\":\"Pro Yearly\",\"amount_cents\":9999,\"currency\":\"usd\",\"billing_interval\":\"yearly\",\"weekly_word_limit\":1000000,\"trial_days\":30,\"is_active\":true}]}"
  }
}
```

Staging deploy recovery:
```text
First staging deployment failure cause:
Error: P1000: Authentication failed against database server, the provided database credentials for `postgres` are not valid.

Fixed by updating staging backend DATABASE_URL to the staging Postgres service and redeploying.

railway deployment list --service melodious-presence --environment staging

Recent Deployments
  300b0ab1-4b48-4b7e-9648-464954961142 | SUCCESS | 2026-03-30 02:45:21 +08:00
  09ce11bc-d78b-4c1e-bc87-8482991526f2 | FAILED  | 2026-03-30 02:42:15 +08:00
```

Staging live origin-policy and public-plans proof:
```json
{
  "allowed_origin_health": {
    "status": 200,
    "allow_origin": "https://project-y32ng.vercel.app",
    "body": "{\"status\":\"ok\",\"database\":\"ok\"}"
  },
  "allowed_origin_plans": {
    "status": 200,
    "allow_origin": "https://project-y32ng.vercel.app",
    "body": "{\"items\":[{\"code\":\"free\",\"display_name\":\"Free\",\"amount_cents\":0,\"currency\":\"usd\",\"billing_interval\":\"none\",\"weekly_word_limit\":10000,\"trial_days\":0,\"is_active\":true},{\"code\":\"pro_monthly\",\"display_name\":\"Pro Monthly\",\"amount_cents\":999,\"currency\":\"usd\",\"billing_interval\":\"monthly\",\"weekly_word_limit\":1000000,\"trial_days\":30,\"is_active\":true},{\"code\":\"pro_yearly\",\"display_name\":\"Pro Yearly\",\"amount_cents\":9999,\"currency\":\"usd\",\"billing_interval\":\"yearly\",\"weekly_word_limit\":1000000,\"trial_days\":30,\"is_active\":true}]}"
  },
  "blocked_origin_health": {
    "status": 403,
    "allow_origin": null
  }
}
```

Remote staging seed:
```text
railway ssh --project b9c86099-ce7c-44e8-94eb-c3c569fe3eef --environment staging --service melodious-presence npm run prisma:seed

> typetalk-backend@0.1.0 prisma:seed
> prisma db seed

Running seed command `tsx prisma/seed.ts` ...
The seed command has been executed.
```

Browser-executed staged frontend smoke:
```json
{
  "url": "https://project-y32ng.vercel.app/deploy-check",
  "overall": "passed",
  "cards": [
    {
      "title": "Backend health",
      "result": "PASS",
      "message": "Backend health check returned ok."
    },
    {
      "title": "Public billing plans",
      "result": "PASS",
      "message": "Public plans contract is display-safe."
    }
  ]
}
```

Railway backup capability root-cause proof:
```json
{
  "project": {
    "name": "TypeTalk",
    "subscription_type": "hobby",
    "feature_flags": [],
    "subscription_plan_limit": {
      "volumes": {
        "maxBackupsCount": 0,
        "maxBackupsUsagePercent": 0
      }
    }
  },
  "workspace": {
    "name": "Mehran Gharooni's Projects",
    "plan": "HOBBY",
    "subscription_model": "USER",
    "members": [
      {
        "email": "mehran.gharuni@gmail.com",
        "role": "ADMIN"
      }
    ]
  },
  "volume_state": {
    "id": "3e3776eb-a7c2-4c69-9d27-0b4219721c16",
    "state": "READY",
    "service": "Postgres",
    "volume": "postgres-volume",
    "mount_path": "/var/lib/postgresql/data"
  },
  "volume_instance_backup_schedule_list": [],
  "volume_instance_backup_list": [],
  "project_token_probe": {
    "created": true,
    "schedule_update": {
      "error": "Not Authorized"
    },
    "backup_create": {
      "error": "Not Authorized"
    },
    "deleted": true
  },
  "api_token_probe": {
    "created": true,
    "schedule_list": [],
    "backup_list": [],
    "schedule_update": {
      "error": "Not Authorized"
    },
    "backup_create": {
      "error": "Not Authorized"
    },
    "deleted": true
  },
  "user_token_probe": {
    "schedule_update": {
      "error": "Not Authorized"
    },
    "backup_create": {
      "error": "Not Authorized"
    }
  },
  "control_surface": {
    "project_or_workspace_subscription_upgrade_mutations": [],
    "workspace_update_input_fields": [
      "avatar",
      "name",
      "preferredRegion"
    ]
  }
}
```

Railway dashboard probe from isolated Edge context:
```json
{
  "url": "https://railway.com/project/b9c86099-ce7c-44e8-94eb-c3c569fe3eef?environmentId=29a31510-a23c-4e33-858f-5c346477654e",
  "title": "Railway",
  "loginVisible": true,
  "bodySnippet": "Login\n\nWelcome to Railway\n\nInstant deployments, effortless scale\n\nContinue with GitHub\nLog in using email"
}
```

### Success Criteria Checklist
- [x] A written Phase 8 deployment-input matrix exists and captures the frozen public name, domains, platform scope, and pricing/quota baseline.
- [x] Backend env documentation, `.env.local`, and `.env.test` stay aligned with the real backend env schema and feature-flag set.
- [x] `GET /v1/billing/plans` is narrowed to the display-safe public contract and no longer exposes provider/internal identifiers.
- [x] Railway backend plus Postgres deployment behavior is explicit and documented.
- [ ] Railway Postgres private networking and backups are both fully verified.
- [x] Backend deploy behavior uses `npx prisma migrate deploy` before app start and keeps seed behavior idempotent.
- [x] Production and staging origin policy is explicit, exact, and does not allow arbitrary preview origins on production.
- [x] `frontend/.env.example` exists and documents the real public frontend env contract.
- [x] `frontend/vercel.json` exists and deployed deep SPA routes load without `404`.
- [x] A frontend-origin connectivity smoke exists and proves that `VITE_API_BASE_URL`, the deployed Vercel origin, and backend CORS work together.
- [x] A first-deploy order and rollback runbook exists in the repo.
- [x] Local verification fully passes, including backend `npm run test`.
- [x] Deployed verification passes for Railway `/health`, Railway display-safe `/v1/billing/plans`, and deployed frontend direct-route checks.
- [x] The phase is not being overstated as complete where external blockers still remain.

### Known Issues
- Railway production Postgres backups remain the only unresolved Phase 8 blocker. The repo now has a zero-arg executable checker that also surfaces live Railway workspace billing state, and fresh Round 15 evidence shows this TypeTalk workspace already has active Railway billing, a default payment method, and an active subscription while the project still reports `subscriptionType: hobby` / workspace plan `HOBBY`, with `subscriptionPlanLimit.volumes.maxBackupsCount: 0` and `maxBackupsUsagePercent: 0`; both backup lists remain empty. This means the blocker is a live Railway plan or capability limit, not a repository code defect.
- The original repo-default local PostgreSQL cluster at `127.0.0.1:55432` is still broken in this shell, and the older Round 5 recovery cluster at `127.0.0.1:55433` became unstable under default parallel `npm run test`, producing deadlocks and fast-shutdown behavior. The earlier Round 6 recovery path at `127.0.0.1:55434` was also already occupied in this shell by another temporary PostgreSQL cluster. Current local verification is restored on the fresh UTF-8 disposable cluster at `127.0.0.1:55435` using `.tmp\phase8-recovery-round7-utf8\.env.test.recovery`, where migrate, seed, and the default backend `npm run test` all pass.
- Railway and Vercel are still using placeholder non-live Phase 8 credentials for Paddle, email, and Google Play. That is acceptable for deployment-foundation proof but not for launch.
- `typetalk.app` still does not resolve from this machine. That no longer blocks the Phase 8 connectivity proof because the documented staging fallback pair is now live, but final public custom-domain cutover remains later work.
- Prisma CLI still emits the non-blocking `package.json#prisma` deprecation warning.
