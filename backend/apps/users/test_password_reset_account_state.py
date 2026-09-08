from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import User, VerificationCode
from .verification import create_password_reset_token


@override_settings(LOGIN_CLIENT_IP_SOURCE="trusted-proxy", LOGIN_TRUSTED_PROXY_CIDRS=[])
class PasswordResetAccountStateTests(APITestCase):
    def test_account_disabled_after_verification_cannot_change_password(self):
        user = User.objects.create_user(
            email="disabled-reset@example.com", password="OriginalPass1",
        )
        now = timezone.now()
        challenge = VerificationCode.objects.create(
            user=user,
            purpose=VerificationCode.Purpose.PASSWORD_RESET,
            code_hash=make_password("4821"),
            expires_at=now + timedelta(minutes=10),
            verified_at=now,
        )
        token = create_password_reset_token(challenge)
        original_password = user.password
        # An administrator disables the account while the reset form is open.
        User.objects.filter(pk=user.pk).update(is_active=False)

        response = self.client.post(reverse("auth-password-reset-confirm"), {
            "token": token,
            "password": "ReplacementPass2",
            "password_confirm": "ReplacementPass2",
        }, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "Şifrə bərpa keçidi etibarsızdır və ya vaxtı bitib.")
        user.refresh_from_db()
        challenge.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertEqual(user.password, original_password)
        self.assertIsNone(challenge.consumed_at)
        self.assertEqual(challenge.verified_at, now)
