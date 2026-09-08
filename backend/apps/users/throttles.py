from datetime import timedelta
from ipaddress import ip_address, ip_network
import math

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework import serializers
from rest_framework.exceptions import Throttled
from rest_framework.throttling import BaseThrottle

from .login_identifiers import find_login_user, normalize_phone
from .models import LoginRateLimit


class LoginThrottled(Throttled):
    def __init__(self, wait):
        super().__init__(wait=wait)
        self.detail = {
            "detail": "Giriş cəhdi limiti bitib. Bir qədər sonra yenidən cəhd edin.",
            "retry_after": self.wait,
        }


class VerificationSendThrottled(Throttled):
    def __init__(self, wait):
        super().__init__(wait=wait)
        self.detail = {
            "detail": "Kod göndərmə limiti bitib. Göstərilən müddətdən sonra yenidən cəhd edin.",
            "retry_after": self.wait,
        }


def client_ip(request):
    """Resolve identity using the explicitly configured ingress trust boundary."""
    def parse(value):
        if "%" in value:
            raise ValueError("Scoped addresses are not client identities")
        address = ip_address(value.strip())
        return getattr(address, "ipv4_mapped", None) or address

    try:
        peer = parse(request.META.get("REMOTE_ADDR", ""))
    except ValueError:
        return "unknown"
    if settings.LOGIN_CLIENT_IP_SOURCE == "railway":
        # Opt-in only for Railway HTTP ingress: its edge overwrites X-Real-IP.
        # Do not fall back to another, potentially client-controlled header.
        real_ip = request.META.get("HTTP_X_REAL_IP", "")
        if not real_ip or len(real_ip) > 64:
            return str(peer)
        try:
            return str(parse(real_ip))
        except ValueError:
            return str(peer)
    networks = [ip_network(value) for value in settings.LOGIN_TRUSTED_PROXY_CIDRS]

    def trusted(address):
        return any(address in network for network in networks)

    if not trusted(peer):
        return str(peer)
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if not forwarded or len(forwarded) > 2048:
        return str(peer)
    try:
        chain = [parse(value) for value in forwarded.split(",")]
    except ValueError:
        return str(peer)
    current = peer
    for address in reversed(chain):
        if not trusted(current):
            break
        current = address
    return str(current)


def consume_attempt(scope, identity, limit, window_seconds):
    """Return remaining wait, or zero after atomically consuming one attempt."""
    if limit <= 0 or window_seconds <= 0:
        raise ImproperlyConfigured("Login limits and windows must be positive.")
    key = salted_hmac(
        "hara.login-rate-limit", f"{scope}:{identity}", algorithm="sha256",
    ).hexdigest()
    with transaction.atomic():
        bucket, _ = LoginRateLimit.objects.select_for_update().get_or_create(
            key=key,
            defaults={"expires_at": timezone.now() + timedelta(seconds=window_seconds)},
        )
        now = timezone.now()
        if bucket.expires_at <= now:
            bucket.attempts = 0
            bucket.expires_at = now + timedelta(seconds=window_seconds)
        if bucket.attempts >= limit:
            return max(1, math.ceil((bucket.expires_at - now).total_seconds()))
        bucket.attempts += 1
        bucket.save(update_fields=("attempts", "expires_at"))
    return 0


class CredentialsLoginThrottle(BaseThrottle):
    def allow_request(self, request, view):
        self.retry_after = 0
        if request.method != "POST":
            return True
        # Check IP before parsing identifiers, querying users or hashing passwords.
        self.retry_after = consume_attempt(
            "ip", client_ip(request), settings.LOGIN_IP_MAX_ATTEMPTS,
            settings.LOGIN_IP_WINDOW_SECONDS,
        )
        if self.retry_after:
            return False
        data = request.data
        try:
            identifier = serializers.CharField(max_length=254).run_validation(
                data.get("identifier") if hasattr(data, "get") else None,
            )
        except serializers.ValidationError:
            return True  # Malformed payloads are still charged to the IP limit.
        user = find_login_user(identifier)
        if user:
            identity = f"user:{user.pk}"
        elif "@" in identifier:
            identity = f"email:{identifier.casefold()}"
        else:
            identity = f"phone:{normalize_phone(identifier)}"
        self.retry_after = consume_attempt(
            "account", identity, settings.LOGIN_ACCOUNT_MAX_ATTEMPTS,
            settings.LOGIN_ACCOUNT_WINDOW_SECONDS,
        )
        return not self.retry_after

    def wait(self):
        return self.retry_after


class SocialLoginThrottle(BaseThrottle):
    def allow_request(self, request, view):
        self.retry_after = 0
        if request.method != "POST":
            return True
        # One budget across both providers, before body parsing or token verification.
        self.retry_after = consume_attempt(
            "social-login-ip", client_ip(request),
            settings.SOCIAL_LOGIN_IP_MAX_ATTEMPTS,
            settings.SOCIAL_LOGIN_IP_WINDOW_SECONDS,
        )
        return not self.retry_after

    def wait(self):
        return self.retry_after


def reserve_verification_send(email):
    """Reserve an email send slot; a denied cooldown must not spend hourly budget."""
    with transaction.atomic():
        wait = consume_attempt(
            "verification-send-email", email,
            settings.AUTH_SEND_EMAIL_MAX_ATTEMPTS, settings.AUTH_SEND_EMAIL_WINDOW_SECONDS,
        )
        if not wait:
            wait = consume_attempt(
                "verification-send-cooldown", email, 1,
                settings.AUTH_CODE_RESEND_COOLDOWN_SECONDS,
            )
        if wait:
            transaction.set_rollback(True)
        return wait


class VerificationSendThrottle(BaseThrottle):
    def allow_request(self, request, view):
        self.retry_after = 0
        if request.method != "POST":
            return True
        # Shared across registration, resend and reset, before any user lookup.
        self.retry_after = consume_attempt(
            "verification-send-ip", client_ip(request),
            settings.AUTH_SEND_IP_MAX_ATTEMPTS, settings.AUTH_SEND_IP_WINDOW_SECONDS,
        )
        if self.retry_after:
            return False
        data = request.data
        try:
            email = serializers.EmailField(max_length=254).run_validation(
                data.get("email") if hasattr(data, "get") else None,
            ).strip().casefold()
        except serializers.ValidationError:
            return True  # Invalid bodies still spend the IP budget.
        self.retry_after = reserve_verification_send(email)
        return not self.retry_after

    def wait(self):
        return self.retry_after
