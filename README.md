# HARA

HARA is an early-stage monorepo for discovering what is happening in the city.

## Structure

```text
.
├── backend/     Django REST API
├── frontend/    Next.js web application
├── docs/        Project documentation
├── .env.example
├── .gitignore
└── README.md
```

## Prerequisites

- Python 3.12
- Node.js 20.9 or newer
- npm

## Environment

Create a local environment file from the example:

```bash
cp .env.example .env
```

The example values are intended only for local development. Replace the Django
secret before using the application in any shared or production environment.

For staging and production, set `DJANGO_DEBUG=false` and supply a private,
random `DJANGO_SECRET_KEY` through the hosting environment. When debug is off
(the default), startup fails if the key is missing, blank, the example value,
or starts with `django-insecure-`. The local fallback is available only with
explicit `DJANGO_DEBUG=true`.

Generate a key locally, then store it in your hosting provider's secret settings:

```bash
python -c 'import secrets; print(secrets.token_urlsafe(64))'
```

Do not commit the generated value or paste it into issues or logs. Before
deploying this change, verify that the hosting environment already has a
private key. Preserve an existing secure key: changing it can invalidate
signed tokens and sessions.

The secret configuration regression tests require no database. Run from `backend/`:

```bash
python -m unittest config.test_secret_key
```

## Backend

From the repository root:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

The API runs at `http://127.0.0.1:8000`. Its health endpoint is:

```text
GET http://127.0.0.1:8000/api/health/
```

Run backend checks and tests with:

```bash
cd backend
source .venv/bin/activate
python manage.py check
python manage.py test
```

## Frontend

In another terminal, from the repository root:

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:3000`.

Run frontend quality checks with:

```bash
cd frontend
npm run lint
npm run build
```

## Current scope

This MVP foundation uses SQLite for local Django development. Authentication,
external UI libraries, Docker, PostgreSQL, Redis, payments, and deployment
configuration are intentionally not included yet.
