# Authentication maintenance in the existing service

No additional Railway service, Redis instance, always-running background process,
or external scheduler is required. Existing application CPU/database usage still
applies; this is not a promise of zero metered resource consumption.

`AuthMaintenanceMiddleware` performs small cleanup passes on POST requests under
`/api/auth/`, after the view produces a non-5xx response. Normal requests cost a
local clock check; only a due request runs database cleanup. Authentication has
already completed, but the triggering HTTP response waits for that small pass.

Each worker starts eligible and checks at most once every 24 hours when caught
up. A pass deletes at most 200 AuthSession records and 200 LoginRateLimit records
whose expiry is **more than one day** in the past. A full batch schedules another
pass after 60 seconds; an error schedules a retry after 5 minutes. Both retries
require later auth traffic. Idle services do not run cleanup at a fixed clock
time. Worker restarts reset this local schedule; multiple workers can run passes.

PostgreSQL row locks with SKIP LOCKED prevent maintenance from waiting on a
counter being renewed by login. Each table pass has a 250 ms lock timeout and
1 second statement timeout. These are per-statement limits, not a total HTTP
deadline. The expiry condition is rechecked on deletion. Cleanup failures retain
the authentication response and log only the exception type, without SQL values.
Logs report only deleted record counts. No user, OTP, order or ticket is deleted.

Set `AUTH_MAINTENANCE_ENABLED=false` to disable traffic-triggered cleanup.
The existing `prune_auth_sessions` and `prune_login_rate_limits` commands remain
available for explicit administrator maintenance of a large backlog. An exact
daily cron schedule is not configured by this change.

## Proxy readiness

`manage.py check` rejects invalid CIDRs, trust-all networks and invalid client-IP
source configuration. Railway deployments still using the default peer-based
identity emit users.W001. The opt-in Railway HTTP-edge mode and its verified
network boundary are documented in [login rate limits](login-rate-limits.md#railway-http-ingress).
No proxy ranges are inferred from edge POPs or public anycast addresses.

## Validation

Run `python manage.py test apps.users.test_maintenance apps.users.test_proxy_checks`
on PostgreSQL. The concurrent-renewal test must run (not skip) before release.
The full backend CI also checks migration consistency and all auth regressions.
