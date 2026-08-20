import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core import signing
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from .models import User, VerificationCode


class VerificationError(Exception):
    pass


class VerificationRateLimited(VerificationError):
    def __init__(self, retry_after):
        self.retry_after = max(1, int(retry_after))
        super().__init__("Yeni kod göndərmək üçün bir qədər gözləyin.")


def _lifetime_seconds():
    return int(getattr(settings, "AUTH_CODE_LIFETIME_SECONDS", 600))


def _resend_cooldown_seconds():
    return int(getattr(settings, "AUTH_CODE_RESEND_COOLDOWN_SECONDS", 60))


def _max_attempts():
    return int(getattr(settings, "AUTH_CODE_MAX_ATTEMPTS", 5))


def _email_copy(purpose, code):
    minutes = max(1, _lifetime_seconds() // 60)
    if purpose == VerificationCode.Purpose.REGISTRATION:
        return (
            "HARA hesabınızı təsdiqləyin",
            (
                f"HARA qeydiyyat kodunuz: {code}\n\n"
                f"Kod {minutes} dəqiqə ərzində etibarlıdır. "
                "Bu sorğunu siz etməmisinizsə, məktubu nəzərə almayın."
            ),
        )
    return (
        "HARA şifrə bərpası",
        (
            f"HARA şifrə bərpa kodunuz: {code}\n\n"
            f"Kod {minutes} dəqiqə ərzində etibarlıdır. "
            "Bu sorğunu siz etməmisinizsə, şifrəniz dəyişdirilməyəcək."
        ),
    )


@transaction.atomic
def issue_verification_code(user, purpose, *, enforce_cooldown=True):
    now = timezone.now()
    latest = (
        VerificationCode.objects.select_for_update()
        .filter(user=user, purpose=purpose, consumed_at__isnull=True)
        .order_by("-created_at")
        .first()
    )
    if latest and enforce_cooldown:
        elapsed = (now - latest.created_at).total_seconds()
        cooldown = _resend_cooldown_seconds()
        if elapsed < cooldown:
            raise VerificationRateLimited(cooldown - elapsed)

    VerificationCode.objects.filter(
        user=user,
        purpose=purpose,
        consumed_at__isnull=True,
    ).update(consumed_at=now)

    code = f"{secrets.randbelow(10_000):04d}"
    challenge = VerificationCode.objects.create(
        user=user,
        purpose=purpose,
        code_hash=make_password(code),
        expires_at=now + timedelta(seconds=_lifetime_seconds()),
    )
    subject, message = _email_copy(purpose, code)
    send_mail(
        subject,
        message,
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
        fail_silently=False,
    )
    return challenge


@transaction.atomic
def verify_challenge(user, purpose, code, *, consume):
    challenge = (
        VerificationCode.objects.select_for_update()
        .filter(user=user, purpose=purpose, consumed_at__isnull=True)
        .order_by("-created_at")
        .first()
    )
    now = timezone.now()
    if not challenge or challenge.expires_at <= now:
        raise VerificationError("Kodun vaxtı bitib. Yeni kod tələb edin.")
    if challenge.attempts >= _max_attempts():
        raise VerificationError("Cəhd limiti bitib. Yeni kod tələb edin.")
    if not check_password(code, challenge.code_hash):
        challenge.attempts += 1
        challenge.save(update_fields=("attempts",))
        raise VerificationError("Təsdiqləmə kodu yanlışdır.")

    challenge.verified_at = now
    update_fields = ["verified_at"]
    if consume:
        challenge.consumed_at = now
        update_fields.append("consumed_at")
    challenge.save(update_fields=update_fields)
    return challenge


def create_password_reset_token(challenge):
    signer = signing.TimestampSigner(salt="hara-password-reset")
    return signer.sign_object(
        {"challenge": str(challenge.id), "user": challenge.user_id}
    )


@transaction.atomic
def consume_password_reset_token(token, new_password):
    signer = signing.TimestampSigner(salt="hara-password-reset")
    try:
        payload = signer.unsign_object(
            token,
            max_age=_lifetime_seconds(),
        )
        challenge = VerificationCode.objects.select_for_update().get(
            id=payload["challenge"],
            user_id=payload["user"],
            purpose=VerificationCode.Purpose.PASSWORD_RESET,
            verified_at__isnull=False,
            consumed_at__isnull=True,
        )
    except (
        KeyError,
        TypeError,
        VerificationCode.DoesNotExist,
        signing.BadSignature,
        signing.SignatureExpired,
    ) as exc:
        raise VerificationError(
            "Şifrə bərpa keçidi etibarsızdır və ya vaxtı bitib."
        ) from exc

    user = User.objects.select_for_update().get(pk=challenge.user_id)
    user.set_password(new_password)
    user.save(update_fields=("password",))
    challenge.consumed_at = timezone.now()
    challenge.save(update_fields=("consumed_at",))
    return user
