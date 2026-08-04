import os
from pathlib import Path
from datetime import timedelta
from urllib.parse import parse_qsl, unquote, urlparse
from dotenv import load_dotenv

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR.parent / ".env")


# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/

SECRET_KEY = os.getenv(
    "DJANGO_SECRET_KEY",
    "django-insecure-local-development-only",
)

DEBUG = os.getenv("DJANGO_DEBUG", "false").lower() == "true"

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
]

CORS_ALLOWED_ORIGINS = []

for origin in default_cors_allowed_origins + get_env_list("CORS_ALLOWED_ORIGINS"):
    if origin not in CORS_ALLOWED_ORIGINS:
        CORS_ALLOWED_ORIGINS.append(origin)

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

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
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
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "AUTH_HEADER_TYPES": ("Bearer",),
}
