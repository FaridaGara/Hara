# Verification attempt limits

These POST endpoints share one IP budget, separate from login and code sending:

- `/api/auth/verify-email/`
- `/api/auth/password-reset/verify/`
- `/api/auth/password-reset/confirm/`

The default is 30 requests per 60-second fixed window. Configure positive
`AUTH_VERIFY_IP_MAX_ATTEMPTS` and `AUTH_VERIFY_IP_WINDOW_SECONDS` values in the
existing backend environment; zero or negative values fail the `users.E009`
startup check. Successful, invalid and malformed requests count. Changing email,
code, reset token or route, and sending a new code do not reset this IP budget.
GET and OPTIONS requests do not consume attempts.

The existing HMAC-keyed `LoginRateLimit` table and `consume_attempt` row locks
store the shared counter under the `verification-attempt-ip` scope. No raw IP,
email, code, token or password is stored in that table. Existing bounded auth
maintenance cleans up expired buckets. Client identity uses the configured
Railway HTTP edge or trusted proxy boundary, as documented in
`login-rate-limits.md`. Visitors sharing a public IP share this budget.

The IP slot commits before body parsing, account lookup, code/password checks
and the endpoint's transaction. The existing `users.E007` guard requires
`ATOMIC_REQUESTS=False` so rejected requests and transaction failures cannot
refund attempts. An exhausted budget returns HTTP 429, an Azerbaijani message,
integer `retry_after` and a matching `Retry-After` header. Rejections do not extend
the window and cannot activate an account, issue tokens, consume a code or
change a password. The existing per-code attempt ceiling and single-use reset
token checks still apply independently.

The verification form maintains separate code-check and code-send countdowns.
On a verification 429 it retains the code, displays the server-supplied wait and
blocks the confirmation action (including form submission) until time expires.
Resending does not reset the verification countdown. The final password form
similarly retains its input and disables confirmation until its wait expires.
Ordinary invalid-code responses do not introduce a new countdown. Countdown
state is local to the form; reloads cannot bypass the server-side budget.

Validation:

- `python manage.py test apps.users.test_verification_attempt_limits` on PostgreSQL:
  shared routes, malformed inputs, protected account/code/password state,
  successful reset, single-use tokens, per-code attempts, rollback persistence,
  independent ingress identities/budgets and nine simultaneous first requests.
- `npm test -- src/components/account-flow.test.tsx`: both verification purposes,
  separate resend timing, forced submission, retained inputs and retry recovery.

No migration, new dependency, additional worker or paid service is required.
