from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.conf import settings
from django.core import mail
from django.db import close_old_connections
from django.test import SimpleTestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from .checks import verification_send_checks
from .models import LoginRateLimit, User, VerificationCode
from .throttles import reserve_verification_send


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    LOGIN_CLIENT_IP_SOURCE="trusted-proxy", LOGIN_TRUSTED_PROXY_CIDRS=[],
    AUTH_SEND_IP_MAX_ATTEMPTS=20, AUTH_SEND_IP_WINDOW_SECONDS=600,
    AUTH_SEND_EMAIL_MAX_ATTEMPTS=2, AUTH_SEND_EMAIL_WINDOW_SECONDS=3600,
    AUTH_CODE_RESEND_COOLDOWN_SECONDS=60,
)
class VerificationSendLimitTests(APITestCase):
    def send(self, email="pending@example.com", route="auth-password-reset-request", ip="192.0.2.1", **extra):
        return self.client.post(reverse(route), {"email": email, **extra}, format="json", REMOTE_ADDR=ip)

    def assertLimited(self, response, wait):
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.data["retry_after"], wait)
        self.assertEqual(response["Retry-After"], str(wait))

    @override_settings(AUTH_SEND_IP_MAX_ATTEMPTS=2)
    def test_ip_budget_spans_all_send_routes_and_charges_invalid_bodies(self):
        self.assertEqual(self.send(email="bad", route="auth-register").status_code, 400)
        self.assertEqual(self.send(email="bad", route="auth-verification-resend").status_code, 400)
        with patch("apps.users.views.issue_verification_code") as issue:
            response = self.send()
        self.assertEqual(response.status_code, 429)
        issue.assert_not_called()
        self.assertEqual(self.send(ip="192.0.2.2").status_code, 200)

    def test_cooldown_is_shared_across_routes_purposes_and_email_case(self):
        now = timezone.now()
        with patch("django.utils.timezone.now", return_value=now):
            self.assertEqual(self.send().status_code, 200)
            self.assertLimited(self.send(" PENDING@EXAMPLE.COM ", route="auth-verification-resend",
                                         ip="192.0.2.2", purpose="registration"), 60)
            self.assertLimited(self.send(route="auth-register", ip="192.0.2.3"), 60)
        with patch("django.utils.timezone.now", return_value=now + timedelta(seconds=60)):
            self.assertEqual(self.send(route="auth-verification-resend", purpose="password_reset").status_code, 200)
        with patch("django.utils.timezone.now", return_value=now + timedelta(seconds=120)):
            self.assertLimited(self.send(ip="192.0.2.4"), 3480)
        with patch("django.utils.timezone.now", return_value=now + timedelta(seconds=3600)):
            self.assertEqual(self.send().status_code, 200)

    def test_cooldown_rejections_do_not_spend_email_budget_or_extend_wait(self):
        now = timezone.now()
        with patch("django.utils.timezone.now", return_value=now):
            self.send()
        with patch("django.utils.timezone.now", return_value=now + timedelta(seconds=10.1)):
            for _ in range(3):
                self.assertLimited(self.send(), 50)
        with patch("django.utils.timezone.now", return_value=now + timedelta(seconds=60)):
            self.assertEqual(self.send().status_code, 200)

    def test_repeat_registration_does_not_replace_pending_password_or_code(self):
        payload = dict(first_name="Aysel", last_name="Test", email="pending@example.com",
                       phone_number="+994501112233", password="SecurePass1",
                       password_confirm="SecurePass1", accept_terms=True)
        first = self.client.post(reverse("auth-register"), payload, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.data["retry_after"], 60)
        user = User.objects.get(email=payload["email"])
        challenge = VerificationCode.objects.get(user=user)
        password_hash = user.password
        repeated = self.client.post(reverse("auth-register"), {
            **payload, "password": "DifferentPass2", "password_confirm": "DifferentPass2",
        }, format="json")
        self.assertEqual(repeated.status_code, 429)
        user.refresh_from_db()
        self.assertEqual(user.password, password_hash)
        self.assertEqual(VerificationCode.objects.get(user=user).pk, challenge.pk)
        self.assertEqual(len(mail.outbox), 1)

    def test_unknown_and_known_reset_histories_have_equal_status_body_and_wait(self):
        User.objects.create_user(email="known@example.com", password="SecurePass1")
        now = timezone.now()
        for seconds in [0, 10, 60, 120]:
            with patch("django.utils.timezone.now", return_value=now + timedelta(seconds=seconds)):
                known = self.send("known@example.com")
                unknown = self.send("unknown@example.com")
            self.assertEqual(known.status_code, unknown.status_code)
            self.assertEqual(known.data, unknown.data)
            self.assertEqual(known.get("Retry-After"), unknown.get("Retry-After"))
        self.assertEqual(len(mail.outbox), 2)

    def test_mail_failure_rolls_back_account_but_keeps_request_budget(self):
        payload = dict(first_name="Aysel", last_name="Test", email="pending@example.com",
                       phone_number="+994501112233", password="SecurePass1",
                       password_confirm="SecurePass1", accept_terms=True)
        with patch("apps.users.verification.send_mail", side_effect=RuntimeError("mail unavailable")):
            with self.assertRaises(RuntimeError):
                self.client.post(reverse("auth-register"), payload, format="json")
        self.assertFalse(User.objects.exists())
        self.assertFalse(VerificationCode.objects.exists())
        self.assertEqual(self.client.post(reverse("auth-register"), payload, format="json").status_code, 429)

    def test_hourly_limit_survives_consumed_codes_and_different_ips(self):
        user = User.objects.create_user(email="known@example.com", password="SecurePass1")
        now = timezone.now()
        for seconds in [0, 60]:
            with patch("django.utils.timezone.now", return_value=now + timedelta(seconds=seconds)):
                self.assertEqual(self.send(user.email, ip=f"192.0.2.{seconds+1}").status_code, 200)
                VerificationCode.objects.filter(user=user).update(consumed_at=timezone.now())
        with patch("django.utils.timezone.now", return_value=now + timedelta(seconds=120)):
            self.assertLimited(self.send(user.email, ip="192.0.2.9"), 3480)
        self.assertEqual(len(mail.outbox), 2)

    def test_counter_keys_are_hashed_and_separate_from_login(self):
        self.send()
        keys = list(LoginRateLimit.objects.values_list("key", flat=True))
        self.assertEqual(len(keys), 3)
        for key in keys:
            self.assertRegex(key, r"^[0-9a-f]{64}$")
        response = self.client.post(reverse("auth-login"), {}, format="json")
        self.assertEqual(response.status_code, 401)


@override_settings(AUTH_SEND_EMAIL_MAX_ATTEMPTS=5, AUTH_SEND_EMAIL_WINDOW_SECONDS=3600,
                   AUTH_CODE_RESEND_COOLDOWN_SECONDS=60)
class VerificationSendConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_parallel_first_sends_reserve_one_slot(self):
        barrier = Barrier(6)

        def reserve(_):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return reserve_verification_send("parallel@example.com")
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=6) as executor:
            waits = list(executor.map(reserve, range(6)))
        self.assertEqual(waits.count(0), 1)
        self.assertEqual(list(LoginRateLimit.objects.values_list("attempts", flat=True)), [1, 1])


class VerificationSendCheckTests(SimpleTestCase):
    @override_settings(AUTH_SEND_EMAIL_MAX_ATTEMPTS=0)
    def test_invalid_limits_fail_configuration_check(self):
        self.assertIn("users.E006", [x.id for x in verification_send_checks(None)])

    def test_request_wide_transaction_configuration_is_rejected(self):
        databases = {**settings.DATABASES, "default": {**settings.DATABASES["default"], "ATOMIC_REQUESTS": True}}
        with override_settings(DATABASES=databases):
            self.assertIn("users.E007", [x.id for x in verification_send_checks(None)])
