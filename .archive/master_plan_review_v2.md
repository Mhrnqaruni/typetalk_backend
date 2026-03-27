## Master Plan Review

### Overall Assessment
The revised master plan is much stronger than the previous version. It now assigns the missing locked routes to phases, fixes the earlier `security_events` dependency problem, restores the mandatory Phase 0 Railway/test-environment work, and places idempotency responsibilities into the phases that actually need them. Phase sizes are reasonable, the execution order is now explicit, and the plan is close to workable. It is still not ready for approval, though, because one launch-critical operational requirement is still not assigned to any phase, and one locked API convention is still missing from the implementation plan.

### Issues Found
- [HIGH] The plan still does not schedule the actual webhook retry executor required for launch. `master_plan.md:145` and `master_plan.md:171` describe retry-safe/retryable webhook handling, and `master_plan.md:216` says the final system must satisfy the webhook retry blocker, but no phase assigns the Railway cron or an equivalent retry worker that the source plan requires in practice (`final_plan.md:201-203`, `final_plan.md:552`, `final_plan.md:857`, `final_plan.md:878`, `final_plan.md:1517`). This is wrong because rows can be durably stored and still never be retried, which strands billing or entitlement updates after transient failures. Fix by assigning a concrete retry executor to a phase, most likely a Railway cron job or equivalent retry process, and define how it picks up `received` and `failed` webhook/event rows. Verify by forcing Stripe and RTDN processing failures, confirming rows remain retryable, then confirming the scheduled retry path reprocesses them successfully.
- [MEDIUM] Cursor pagination is still missing from the implementation plan. The locked API conventions require cursor pagination (`final_plan.md:1016`), but `master_plan.md` does not assign pagination support or verification to any phase even though multiple endpoints return lists (`GET /v1/sessions`, `GET /v1/devices`, `GET /v1/dictionary`, `GET /v1/writing-profiles`, `GET /v1/billing/invoices`, `GET /v1/admin/subscriptions`, `GET /v1/admin/usage`). This is wrong because the executor could follow the plan and still ship collection endpoints that do not match the locked API contract. Fix by adding shared pagination infrastructure to Phase 0 or the earliest relevant route phase, then require it in the definitions of done for collection endpoints. Verify by checking representative list endpoints accept `limit` and `cursor` and return `items` plus `next_cursor`.

### Suggestions
- Add an explicit retry-runner deliverable, owner phase, and failure-injection verification for both Stripe webhooks and Google RTDN events.
- Add a shared pagination contract to the plan and call it out in the definition of done for every list endpoint phase.
- Keep the new scope matrix and definition-of-done structure; those changes materially improved the plan and should remain.

### Verdict
VERDICT: NEEDS_REVISION
