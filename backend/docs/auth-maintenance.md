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

`manage.py check` now rejects invalid CIDRs and trust-all networks with users.E001
and users.E002. A Railway deployment with no trusted proxy CIDRs emits users.W001.
The warning does not invent or automatically trust internal networks.

Before configuring production trust, verify the actual ingress peer ranges and
how Railway overwrites/appends X-Forwarded-For, including requests with a forged
client-provided header and any direct/private ingress path. The public edge POP
identifier or anycast address is not evidence of the application's trusted peer
CIDR. See https://docs.railway.com/networking/edge-networking.

Until those facts are verified, forwarded values remain ignored. Proxy trust is
still a deployment follow-up; this PR adds validation, not an unverified allowlist.

## Validation

Run `python manage.py test apps.users.test_maintenance apps.users.test_proxy_checks`
on PostgreSQL. The concurrent-renewal test must run (not skip) before release.
The full backend CI also checks migration consistency and all auth regressions.
