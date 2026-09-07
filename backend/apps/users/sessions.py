from datetime import datetime, timezone as datetime_timezone
from uuid import UUID

from django.db import transaction
from django.utils import timezone
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.utils import get_md5_hash_password

from .models import AuthSession


SESSION_ERROR = "Sessiya bitib. Yenidən daxil olun."


def session_id(token):
    try:
        return UUID(str(token.get("sid", "")))
    except (ValueError, TypeError, AttributeError) as exc:
        raise InvalidToken(SESSION_ERROR) from exc


def parse_refresh(raw_token):
    try:
        return RefreshToken(raw_token)
    except TokenError as exc:
        raise InvalidToken(SESSION_ERROR) from exc


@transaction.atomic
def issue_session(user):
    if not user.is_active:
        raise InvalidToken(SESSION_ERROR)
    refresh = RefreshToken.for_user(user)
    session = AuthSession.objects.create(
        user=user,
        refresh_jti=refresh[api_settings.JTI_CLAIM],
        expires_at=datetime.fromtimestamp(refresh["exp"], tz=datetime_timezone.utc),
    )
    refresh["sid"] = str(session.id)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


@transaction.atomic
def rotate_session(raw_token):
    refresh = parse_refresh(raw_token)
    try:
        session = AuthSession.objects.select_for_update().select_related("user").get(
            pk=session_id(refresh), user_id=refresh[api_settings.USER_ID_CLAIM],
        )
    except (AuthSession.DoesNotExist, KeyError, ValueError, TypeError) as exc:
        raise InvalidToken(SESSION_ERROR) from exc
    if (
        session.revoked_at is not None
        or session.expires_at <= timezone.now()
        or not session.user.is_active
        or session.refresh_jti != refresh.get(api_settings.JTI_CLAIM)
        or refresh.get(api_settings.REVOKE_TOKEN_CLAIM)
        != get_md5_hash_password(session.user.password)
    ):
        raise InvalidToken(SESSION_ERROR)
    replacement = RefreshToken.for_user(session.user)
    replacement["sid"] = str(session.id)
    # Rotation does not extend the original session's seven-day lifetime.
    replacement["exp"] = int(session.expires_at.timestamp())
    session.refresh_jti = replacement[api_settings.JTI_CLAIM]
    session.save(update_fields=("refresh_jti",))
    return {"access": str(replacement.access_token), "refresh": str(replacement)}


@transaction.atomic
def revoke_session(raw_token):
    refresh = parse_refresh(raw_token)
    try:
        session = AuthSession.objects.select_for_update().get(
            pk=session_id(refresh), user_id=refresh[api_settings.USER_ID_CLAIM],
        )
    except (AuthSession.DoesNotExist, KeyError, ValueError, TypeError) as exc:
        raise InvalidToken(SESSION_ERROR) from exc
    # A valid older token can revoke its whole session after a refresh race.
    # The signed sid/user claims prevent revocation of another session.
    if session.revoked_at is None:
        session.revoked_at = timezone.now()
        session.save(update_fields=("revoked_at",))


class SessionJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if not AuthSession.objects.filter(
            pk=session_id(validated_token), user=user,
            revoked_at__isnull=True, expires_at__gt=timezone.now(),
        ).exists():
            raise InvalidToken(SESSION_ERROR)
        return user


# Preserve the existing OpenAPI bearer scheme for the custom authenticator.


class SessionJWTScheme(OpenApiAuthenticationExtension):
    target_class = "apps.users.sessions.SessionJWTAuthentication"
    name = "jwtAuth"

    def get_security_definition(self, auto_schema):
        return {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
