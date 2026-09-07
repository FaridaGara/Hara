# Session rotation and logout

All HARA-issued JWT pairs now carry a signed `sid`. AuthSession stores the
session ID, user, current refresh JTI, creation/expiry time, and revocation time.
No raw token is stored in this table.

- Login, email verification, and social login issue a new session/pair.
- POST /api/auth/refresh/ accepts `{ "refresh": "..." }` and returns a new access
  AND refresh token. Clients must replace the refresh token. The old refresh is
  single-use; access tokens already issued for the active session retain their
  normal validity. Session expiry remains the original seven-day deadline.
- POST /api/auth/logout/ accepts the same body and returns 204. It requires a
  signed, unexpired refresh token rather than an access token, so logout works
  after access expires. Repeating logout is safe. An older rotated refresh can
  revoke its session too, closing the refresh/logout race.
- Every authenticated API request checks that its session is unexpired and not
  revoked. Logout therefore rejects previously issued access tokens on subsequent
  requests as well as refresh attempts. Requests already authenticated/in flight
  when logout occurs cannot be retroactively undone.
- Other independently created sessions/devices remain active.
- CHECK_REVOKE_TOKEN binds tokens to the password state. Password reset/change
  invalidates existing access and refresh tokens. Inactive users are rejected.
- Missing/legacy sid, malformed, expired, or replayed refresh tokens return 401.
  Invalid request bodies return 400. Raw tokens must never be logged.

The client shares one refresh request per local session. A session generation
check prevents late refresh/profile responses from restoring a logged-out user
or overwriting a newer login. Logout clears local tokens immediately and sends
revocation without automatically refreshing first. If the network fails, a
visible retry action uses a token retained only in memory; close/reload discards
that retry state. Do not report remote revocation as successful while offline.

## Deployment gates

This PR is stacked on login-rate-limits PR #6: users.0006_authsession depends on
users.0005_loginratelimit. Merge/deploy the prerequisites in order. Also include
the earlier auth fixes (#3-#5) in the final release.

1. Apply migrations before serving the new code.
2. Deploy the matching backend and frontend together. Old token pairs are rejected
   and all existing users must log in again once. Avoid a mixed old/new backend
   pool: old workers would not enforce session revocation.
3. Keep DJANGO_SECRET_KEY stable and private across workers; verify CHECK_REVOKE_TOKEN
   remains enabled. Do not restore the stock refresh endpoint/authenticator.
4. Run the PostgreSQL concurrency tests in apps.users.test_sessions, plus the
   login limiter test inherited from PR #6. SQLite cannot verify row locks.
5. Schedule `python manage.py prune_auth_sessions` daily (expired for over one day).
6. Verify login, rotation, logout, offline retry, password reset, and independent
   device sessions against staging, then monitor auth latency/401 rates. Each
   authenticated request adds a session lookup.

Refresh tokens still reside in sessionStorage in this change. HttpOnly cookie/BFF
transport and its CORS/CSRF/deployment design remain a separate task; this change
does not eliminate JavaScript/XSS exposure. Duplicated tabs that clone the same
refresh token may require re-login after competing rotations. A lost successful
refresh response also requires re-login because the old token is already consumed.
Refresh/logout endpoint abuse limits remain separate from credential-login limits.
