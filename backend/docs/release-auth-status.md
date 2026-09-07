# Authentication release status — 2026-09-07

Requested order: release PRs #3–#6, then finish and release #7.

## Verified

- PRs #3–#6 merge together without conflicts. Auth-only SQLite run: 47 tests, 46 passed, one PostgreSQL concurrency test skipped.
- PRs #3–#7 merge together without conflicts. Auth-only SQLite run including production-secret configuration tests: 60 tests, 57 passed, three PostgreSQL concurrency tests skipped.
- PR #7 Vercel preview at commit ed15ac99580879d7f65948dbea067dcce53ddbd6 reached READY. This is a frontend build, not a verified working backend integration.
- Railway's existing backend start command runs migrations before Gunicorn. The production service has a DJANGO_SECRET_KEY variable; its value and validity have not been inspected or changed.

- PR #7 frontend verification after correcting stale event-detail assertions: all 92 tests passed; TypeScript and ESLint for the changed test passed.

## External blockers

- Railway workspace trial has expired. Both Hara and PostGIS are offline and the Hara service has no active deployment. The dashboard explicitly requires a plan upgrade to continue deploying.
- GitHub Actions run 34159942924 did not start any job steps. Annotation: "The job was not started because your account is locked due to a billing issue."
- The local runtime lacks GDAL/PostGIS, so full backend and real row-lock concurrency tests remain unverified. SQLite is not a substitute for these checks.

## Resume sequence

1. Restore Railway service eligibility and GitHub Actions billing; rerun backend CI on #6. Confirm production secret validity without exposing its value and configure verified trusted proxy CIDRs for login limits.
2. Merge #3–#6 in order, using merge commits to preserve the stacked #7 ancestry. Verify backend migration users.0005_loginratelimit, deployment health, and frontend production deployment.
3. Retarget #7 from fix/login-rate-limits to main. Run full PostGIS and frontend CI on the integrated revision. All three concurrency tests must run and pass.
4. Apply users.0006_authsession and deploy matching backend/frontend. Existing tokens lack sid and require a fresh login. Verify login, single-use refresh, logout invalidation, independent device sessions, and logout failure feedback against the live services.
5. Schedule prune_login_rate_limits and prune_auth_sessions daily. Confirm the frontend API base URL points to the restored backend.

No production merge, database migration, billing change, or production deployment has been performed during this release attempt.
