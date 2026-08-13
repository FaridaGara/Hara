from dataclasses import dataclass

import jwt
from django.conf import settings
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token


class SocialTokenError(ValueError):
    pass


@dataclass(frozen=True)
class SocialClaims:
    subject: str
    email: str
    email_verified: bool
    first_name: str = ""
    last_name: str = ""
    display_name: str = ""
    avatar_url: str = ""
    authoritative_email: bool = False


def verify_google_token(token):
    if not settings.GOOGLE_OAUTH_CLIENT_IDS:
        raise SocialTokenError("Google login is not configured.")

    try:
        claims = google_id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
        )
    except (GoogleAuthError, ValueError, TypeError) as exc:
        raise SocialTokenError("Google identity token is invalid.") from exc

    if claims.get("aud") not in settings.GOOGLE_OAUTH_CLIENT_IDS:
        raise SocialTokenError("Google identity token audience is invalid.")

    email = str(claims.get("email", "")).strip().casefold()
    subject = str(claims.get("sub", "")).strip()
    verified = claims.get("email_verified") is True
    if not subject or not email or not verified:
        raise SocialTokenError("Google account email is not verified.")

    return SocialClaims(
        subject=subject,
        email=email,
        email_verified=True,
        first_name=str(claims.get("given_name", "")).strip(),
        last_name=str(claims.get("family_name", "")).strip(),
        display_name=str(claims.get("name", "")).strip(),
        avatar_url=str(claims.get("picture", "")).strip(),
        authoritative_email=email.endswith("@gmail.com") or bool(claims.get("hd")),
    )


def verify_apple_token(token):
    if not settings.APPLE_OAUTH_CLIENT_IDS:
        raise SocialTokenError("Apple login is not configured.")

    try:
        signing_key = jwt.PyJWKClient(
            "https://appleid.apple.com/auth/keys",
            cache_jwk_set=True,
            lifespan=3600,
        ).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.APPLE_OAUTH_CLIENT_IDS,
            issuer="https://appleid.apple.com",
        )
    except jwt.PyJWTError as exc:
        raise SocialTokenError("Apple identity token is invalid.") from exc

    email = str(claims.get("email", "")).strip().casefold()
    subject = str(claims.get("sub", "")).strip()
    verified = claims.get("email_verified") in (True, "true")
    if not subject or not email or not verified:
        raise SocialTokenError("Apple account email is not verified.")

    return SocialClaims(
        subject=subject,
        email=email,
        email_verified=True,
        authoritative_email=True,
    )
