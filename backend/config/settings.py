import os
from pathlib import Path
from datetime import timedelta
from urllib.parse import parse_qsl, unquote, urlparse
from corsheaders.defaults import default_headers
from dotenv import load_dotenv
from django.core.exceptions import ImproperlyConfigured

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR.parent / ".env")


# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/

DEBUG = os.getenv("DJANGO_DEBUG", "false").lower() == "true"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")

if not DEBUG and (
    not SECRET_KEY.strip()
    or SECRET_KEY.strip().startswith("django-insecure-")
    or SECRET_KEY.strip() == "replace-with-a-local-development-secret"
):
    raise ImproperlyConfigured(
        "Set DJANGO_SECRET_KEY to a private random value when DJANGO_DEBUG "
        "is false. Development keys and empty values are not allowed."
    )

if DEBUG and not SECRET_KEY.strip():
    SECRET_KEY = "django-insecure-local-development-only"

def get_env_list(variable_name):
    return [
        value.strip()
        for value in os.getenv(variable_name, "").split(",")
        if value.strip()
    ]


railway_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN")

ALLOWED_HOSTS = [
    "localhost",
    "127.0.0.1",
]

ALLOWED_HOSTS += get_env_list("ALLOWED_HOSTS")

if railway_domain and railway_domain not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(railway_domain)


CSRF_TRUSTED_ORIGINS = get_env_list("CSRF_TRUSTED_ORIGINS")

if railway_domain:
    railway_origin = f"https://{railway_domain}"

    if railway_origin not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(railway_origin)


SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    "ticketing",
    'django.contrib.auth',
    "events",
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.gis',
    'corsheaders',
    'rest_framework',
    'drf_spectacular',
    'apps.users.apps.UsersConfig',
    'apps.core',
]

AUTH_USER_MODEL = 'users.User'

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'apps.users.maintenance.AuthMaintenanceMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

default_cors_allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://hara-tau.vercel.app",
    "https://hara.today",
    "https://www.hara.today",
]

CORS_ALLOWED_ORIGINS = []

for origin in default_cors_allowed_origins + get_env_list("CORS_ALLOWED_ORIGINS"):
    if origin not in CORS_ALLOWED_ORIGINS:
        CORS_ALLOWED_ORIGINS.append(origin)

CORS_ALLOW_HEADERS = (
    *default_headers,
    "idempotency-key",
)

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases

def get_database_config():
    database_url = os.getenv("DATABASE_URL", "").strip()

    if database_url:
        parsed_url = urlparse(database_url)
        options = dict(parse_qsl(parsed_url.query))

        return {
            'ENGINE': 'django.contrib.gis.db.backends.postgis',
            'NAME': unquote(parsed_url.path.lstrip('/')),
            'USER': unquote(parsed_url.username or ''),
            'PASSWORD': unquote(parsed_url.password or ''),
            'HOST': parsed_url.hostname or '',
            'PORT': str(parsed_url.port or 5432),
            'OPTIONS': options,
        }

    options = {}
    sslmode = os.getenv('DB_SSLMODE', 'require').strip()

    if sslmode:
        options['sslmode'] = sslmode

    return {
        'ENGINE': 'django.contrib.gis.db.backends.postgis',
        'NAME': os.getenv('DB_NAME', 'hara'),
        'USER': os.getenv('DB_USER', 'hara'),
        'PASSWORD': os.getenv('DB_PASSWORD', ''),
        'HOST': os.getenv('DB_HOST', 'localhost'),
        'PORT': os.getenv('DB_PORT', '5432'),
        'OPTIONS': options,
    }


DATABASES = {
    'default': get_database_config(),
}


# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = 'static/'

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

PAYMENT_PROVIDER = os.getenv(
    "PAYMENT_PROVIDER",
    "sandbox",
).strip().lower()
PAYMENT_SANDBOX_ENABLED = (
    os.getenv("PAYMENT_SANDBOX_ENABLED", "false").lower()
    == "true"
)
PAYMENT_WEBHOOK_SECRET = os.getenv(
    "PAYMENT_WEBHOOK_SECRET",
    "",
)
ORDER_RESERVATION_MINUTES = int(
    os.getenv("ORDER_RESERVATION_MINUTES", "15")
)

GOOGLE_OAUTH_CLIENT_IDS = get_env_list("GOOGLE_OAUTH_CLIENT_IDS")
APPLE_OAUTH_CLIENT_IDS = get_env_list("APPLE_OAUTH_CLIENT_IDS")

EMAIL_BACKEND = os.getenv(
    "EMAIL_BACKEND",
    "django.core.mail.backends.console.EmailBackend",
)
EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "true").lower() == "true"
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "HARA <no-reply@hara.today>")

AUTH_CODE_LIFETIME_SECONDS = int(
    os.getenv("AUTH_CODE_LIFETIME_SECONDS", "600")
)
AUTH_CODE_RESEND_COOLDOWN_SECONDS = int(
    os.getenv("AUTH_CODE_RESEND_COOLDOWN_SECONDS", "60")
)
AUTH_CODE_MAX_ATTEMPTS = int(os.getenv("AUTH_CODE_MAX_ATTEMPTS", "5"))

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "apps.users.sessions.SessionJWTAuthentication",
    ),
    "DEFAULT_SCHEMA_CLASS": (
        "drf_spectacular.openapi.AutoSchema"
    ),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "HARA API",
    "DESCRIPTION": (
        "HARA event discovery, ordering, payment, ticket and "
        "organizer operations API."
    ),
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "ENUM_NAME_OVERRIDES": {
        "EventStatusEnum": "events.models.Event.Status",
        "OrderStatusEnum": "ticketing.models.Order.Status",
        "PaymentStatusEnum": "ticketing.models.Payment.Status",
        "TicketStatusEnum": "ticketing.models.Ticket.Status",
        "TicketSalesStatusEnum": (
            "ticketing.sales.TicketSalesStatus"
        ),
        "WebhookOutcomeStatusEnum": [
            "processed",
            "duplicate",
            "ignored",
        ],
    },
}


SIMPLE_JWT = {
    "CHECK_REVOKE_TOKEN": True,
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "AUTH_HEADER_TYPES": ("Bearer",),
}


# Shared database-backed limits for credential login requests.
LOGIN_IP_MAX_ATTEMPTS = int(os.getenv("LOGIN_IP_MAX_ATTEMPTS", "30"))
LOGIN_IP_WINDOW_SECONDS = int(os.getenv("LOGIN_IP_WINDOW_SECONDS", "60"))
LOGIN_ACCOUNT_MAX_ATTEMPTS = int(os.getenv("LOGIN_ACCOUNT_MAX_ATTEMPTS", "10"))
LOGIN_ACCOUNT_WINDOW_SECONDS = int(os.getenv("LOGIN_ACCOUNT_WINDOW_SECONDS", "300"))
# Separate IP budget shared by Google and Apple token verification requests.
SOCIAL_LOGIN_IP_MAX_ATTEMPTS = int(os.getenv("SOCIAL_LOGIN_IP_MAX_ATTEMPTS", "10"))
SOCIAL_LOGIN_IP_WINDOW_SECONDS = int(os.getenv("SOCIAL_LOGIN_IP_WINDOW_SECONDS", "60"))
# Empty by default: ignore forwarded headers until deployment peers are verified.
LOGIN_TRUSTED_PROXY_CIDRS = get_env_list("LOGIN_TRUSTED_PROXY_CIDRS")
# Railway mode requires an HTTP-edge-only public ingress; see login-rate-limits.md.
LOGIN_CLIENT_IP_SOURCE = os.getenv("LOGIN_CLIENT_IP_SOURCE", "trusted-proxy")

# Shared across registration, verification resend and password-reset requests.
AUTH_SEND_IP_MAX_ATTEMPTS = int(os.getenv("AUTH_SEND_IP_MAX_ATTEMPTS", "20"))
AUTH_SEND_IP_WINDOW_SECONDS = int(os.getenv("AUTH_SEND_IP_WINDOW_SECONDS", "600"))
AUTH_SEND_EMAIL_MAX_ATTEMPTS = int(os.getenv("AUTH_SEND_EMAIL_MAX_ATTEMPTS", "5"))
AUTH_SEND_EMAIL_WINDOW_SECONDS = int(os.getenv("AUTH_SEND_EMAIL_WINDOW_SECONDS", "3600"))

# Bounded cleanup runs on auth traffic in the existing service, without cron.
AUTH_MAINTENANCE_ENABLED = os.getenv("AUTH_MAINTENANCE_ENABLED", "true").lower() == "true"
