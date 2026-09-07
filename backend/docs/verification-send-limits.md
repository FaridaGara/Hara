# Verification delivery request limits

Registration (`/api/auth/register/`), verification resend
(`/api/auth/verification/resend/`, both purposes), and password reset request
(`/api/auth/password-reset/request/`) share one policy:

| Setting | Default |
| --- | --- |
| AUTH_SEND_IP_MAX_ATTEMPTS | 20 |
| AUTH_SEND_IP_WINDOW_SECONDS | 600 |
| AUTH_SEND_EMAIL_MAX_ATTEMPTS | 5 |
| AUTH_SEND_EMAIL_WINDOW_SECONDS | 3600 |
| AUTH_CODE_RESEND_COOLDOWN_SECONDS | 60 |

All values must be positive. Every POST spends an IP attempt before parsing the
body or querying a user. A syntactically valid email (trimmed and case-folded)
reserves an hourly email slot and a cooldown slot before remaining form validation.
Unknown emails and ineligible accounts follow the same reservations. Invalid
form submissions and mail failures can spend a slot: these limits measure requests,
not confirmed delivery. IP-denied requests do not spend email slots. Email/cooldown
rejections do not extend expiry or spend another hourly email slot, but count
against the IP budget. Changing endpoint, purpose, email casing, or IP does not
reset the email budget. Consumed/expired codes do not reset these counters.

The existing LoginRateLimit table stores separately scoped HMAC keys, without raw
IP, email, password or OTP values. Row locks and atomic email + cooldown reservation
allow only one parallel request into a send slot. Throttles run before view
transactions, so SMTP failures/account rollbacks do not undo reservations.
ATOMIC_REQUESTS=True is rejected by a system check. No new migration or service is
needed. Existing auth maintenance prunes expired counters.

429 responses include localized detail, numeric retry_after and matching Retry-After
header. Successful requests include retry_after as the next-send delay. Known and
unknown password-reset emails with equal request histories have equal response
status/body and retry information, including 429. This does not claim constant-time
SMTP behavior or hide the pre-existing registration duplicate-account validation.

All three forms honor retry_after, display a countdown and block send buttons during
the wait. Verification remains usable while resending is blocked. UI timers are
advisory; reloading cannot bypass backend enforcement. Resend success is announced
and old code inputs are cleared. Deadline timers recover from background tabs.

## Deployment and validation

Defaults activate in the existing Railway app, retaining LOGIN_CLIENT_IP_SOURCE=railway.
No new paid service, Redis or scheduler is needed; normal resource usage applies.
Probe repeated reset requests to a reserved `.invalid` email for 200 then 429
without sending mail. Run full PostgreSQL CI, including
VerificationSendConcurrencyTests.test_parallel_first_sends_reserve_one_slot.
Frontend tests cover server waits after success and 429. Backend tests cover bad
payloads, cross-route/email/IP budgets, stable waits, SMTP failure, repeat
registration and known/unknown response parity.

Rollback uses the prior application version. Fixed windows permit boundary bursts;
shared NATs share IP budgets and targeted code requests can temporarily block an
email. This change covers sending codes, not social-login/refresh policies or
edge-level distributed traffic protection.
