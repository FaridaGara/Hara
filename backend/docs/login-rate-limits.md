# Credential login rate limits

`POST /api/auth/login/` consumes both an IP budget and an account budget before
password verification. Successful and failed attempts count; successful login
does not reset the budget. Requests denied by the account limit still consume
IP budget. Denied requests do not extend the current window.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| LOGIN_IP_MAX_ATTEMPTS | 30 | Requests per IP window |
| LOGIN_IP_WINDOW_SECONDS | 60 | IP window duration |
| LOGIN_ACCOUNT_MAX_ATTEMPTS | 10 | Requests per account window |
| LOGIN_ACCOUNT_WINDOW_SECONDS | 300 | Account window duration |
| LOGIN_CLIENT_IP_SOURCE | trusted-proxy | `trusted-proxy` (CIDR-checked XFF) or opt-in `railway` (edge X-Real-IP) |
| LOGIN_TRUSTED_PROXY_CIDRS | empty | Comma-separated trusted reverse-proxy networks |

Limits and window durations must be positive integers. Fixed windows start at
the first counted attempt and reset on the first request after expiry. This
permits a burst across a window boundary; it is not a rolling-window limit.

A known account's email and unambiguous active phone number map to one user ID,
including email case and supported phone formatting variants. Unknown identifiers
receive the same numeric limits using normalized identifiers. Counters use HMAC
keys, so this table contains no raw email, phone, IP, or password values.

A throttled request returns HTTP 429, a numeric `retry_after` in seconds, and a
matching `Retry-After` header. Clients should display `detail` and honor the wait.

## Deployment

1. Run `python manage.py migrate` before routing traffic to this version. The
   `users.0005_loginratelimit` migration creates the shared counter table.
2. Verify client IP handling on staging. With no trusted networks configured,
   the limiter uses REMOTE_ADDR and ignores X-Forwarded-For. Behind a proxy this
   can group all visitors under one IP. Configure only verified infrastructure
   peer networks, and ensure those proxies overwrite or append the real sender
   to X-Forwarded-For. Never trust all addresses (0.0.0.0/0 or ::/0).
3. Expired counters are pruned in bounded passes on auth traffic by the existing
   service; see [auth maintenance](auth-maintenance.md). The explicit
   `prune_login_rate_limits` command remains available for a large backlog.
4. Run the concurrency regression test on PostgreSQL:
   `python manage.py test apps.users.test_login_throttles`.

The limiter uses the existing shared database, with row locks and a unique key
for concurrent counter creation. It does not use process-local cache or require
Redis. A database error fails the request rather than bypassing the limiter.
Keep credential login outside request-wide ATOMIC_REQUESTS transactions: rejected
requests must not roll back consumed budgets. Current settings use the default
ATOMIC_REQUESTS=False.

This controls credential login only. Social login, registration, OTP endpoints,
and token refresh need their own policies. It does not replace edge-level traffic
limits: requests still reach the application and database. Sustained distributed
attempts can temporarily deny a known account; monitor 429 rates and adjust the
limits using real traffic. Key rotation changes HMAC counter keys and resets
existing budgets. No production settings or scheduled jobs are applied by this PR.


## Railway HTTP ingress

Set `LOGIN_CLIENT_IP_SOURCE=railway` and leave `LOGIN_TRUSTED_PROXY_CIDRS` empty
only when all public requests enter through Railway's HTTP edge. This uses the
single `X-Real-IP` value, ignores X-Forwarded-For and CF-Connecting-IP, canonicalizes
IPv6/mapped IPv4, and falls back to REMOTE_ADDR if the edge header is missing or
malformed. Address lists, ports and scoped IPv6 addresses are rejected. Account
limits still apply across IP addresses. Existing counters expire normally.

The trust boundary is **deployment networking**, not a header, a hostname or an
environment flag. Do not enable public TCP forwarding to the application port or
another path that bypasses the HTTP edge. Private-network callers must be trusted;
do not forward untrusted request headers through an internal service to this app.
If that topology changes, disable Railway mode until that ingress is secured.
The RAILWAY_PUBLIC_DOMAIN check catches accidental configuration outside Railway;
it cannot prove the network topology. No guessed proxy CIDRs are used.

Evidence checked 2026-09-07:
- [Railway specs](https://docs.railway.com/networking/public-networking/specs-and-limits)
  document X-Real-IP as the client's remote IP.
- [Railway employee clarification](https://station.railway.com/questions/need-authoritative-railway-client-ip-p-b7a7b4bd)
  confirms the edge always sets/overwrites that header and HTTP-proxied apps cannot
  be reached directly. This is an employee statement, not a published CIDR contract.
- HARA service settings show one public HTTP domain to port 8080 and no configured
  TCP proxy. Its production private network contains the Hara app and PostGIS.

`manage.py check` rejects unknown modes, Railway mode without a public domain, and
mixing Railway mode with CIDR trust. The default remains unchanged for local and
other hosting environments. Roll back by setting LOGIN_CLIENT_IP_SOURCE to
trusted-proxy; with empty CIDRs this restores shared peer-based limits.
