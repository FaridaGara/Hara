# Google and Apple login request limits

Both POST endpoints (`/api/auth/google/` and `/api/auth/apple/`) share one
database-backed IP budget: 10 requests per 60-second fixed window by default.
Change `SOCIAL_LOGIN_IP_MAX_ATTEMPTS` and `SOCIAL_LOGIN_IP_WINDOW_SECONDS` in the
existing backend environment to tune it. Zero or negative settings fail startup
checks (`users.E008`). These are request limits, so successful logins count too.

The IP slot is committed before parsing request data, validating an identity
token, contacting its provider, linking a user or creating a session. Switching
between providers does not reset it. Malformed bodies, invalid or oversized
credentials, missing Apple nonces, rejected accounts and provider errors still
consume their slot. Credentials are capped at 16,384 characters before provider
verification. GET and OPTIONS requests do not consume this budget.

An exhausted budget returns HTTP 429 with the existing Azerbaijani login-limit
message, integer `retry_after` in the JSON body and matching `Retry-After` header.
Rejections do not extend the window. The frontend already displays the API error.
Password-login and email-code-send budgets remain separate.

The implementation reuses `client_ip`, `consume_attempt` and the existing
`LoginRateLimit` table with a distinct `social-login-ip` scope. IP resolution uses
the configured Railway HTTP edge boundary or explicitly trusted proxy chain;
client-supplied forwarding headers cannot choose a new budget outside that
boundary. Visitors behind the same public IP share this budget. Stored keys are
HMAC digests; no raw IP or provider token is stored in the rate-limit table.
Existing bounded auth maintenance removes expired buckets. No migration, Redis,
worker or additional service is required. `ATOMIC_REQUESTS` must remain false,
enforced by the existing `users.E007` check, so failures cannot refund IP slots.

Verification: `python manage.py test apps.users.test_social_login_throttles`
on PostgreSQL runs shared-provider API limits, malformed and successful requests,
window expiry, provider failures, ingress isolation, configuration guards and
eight simultaneous first requests against a shared three-slot budget. Provider
verification is mocked; the tests create no external accounts or provider traffic.
