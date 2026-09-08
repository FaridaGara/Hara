from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth.hashers import make_password
from django.db import close_old_connections
from django.test import SimpleTestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from .checks import verification_attempt_checks
from .models import AuthSession, LoginRateLimit, User, VerificationCode
from .verification import create_password_reset_token


ROUTES = ("auth-verify-email", "auth-password-reset-verify", "auth-password-reset-confirm")


@override_settings(
    LOGIN_CLIENT_IP_SOURCE="trusted-proxy", LOGIN_TRUSTED_PROXY_CIDRS=[],
    AUTH_VERIFY_IP_MAX_ATTEMPTS=3, AUTH_VERIFY_IP_WINDOW_SECONDS=60,
    AUTH_MAINTENANCE_ENABLED=False,
)
class VerificationAttemptLimitTests(APITestCase):
    def post(self, route=ROUTES[0], payload=None, ip="192.0.2.1", **headers):
        return self.client.post(
            reverse(route), payload if payload is not None else {},
            format="json", REMOTE_ADDR=ip, **headers,
        )

    def assertLimited(self, response, wait=None):
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response["Retry-After"]), 0)
        self.assertEqual(response.data["retry_after"], int(response["Retry-After"]))
        if wait is not None:
            self.assertEqual(response.data["retry_after"], wait)
        for key in ("access", "refresh", "reset_token"):
            self.assertNotIn(key, response.data)

    def challenge(self, purpose, *, verified=False):
        user = User.objects.create_user(
            email=f"{purpose}@example.com", password="OriginalPass1",
            is_active=purpose == VerificationCode.Purpose.PASSWORD_RESET,
        )
        challenge = VerificationCode.objects.create(
            user=user, purpose=purpose, code_hash=make_password("4821"),
            expires_at=timezone.now() + timedelta(minutes=10),
            verified_at=timezone.now() if verified else None,
        )
        return user, challenge

    def test_malformed_requests_share_budget_and_are_rejected_before_parsing(self):
        self.assertEqual(self.client.post(
            reverse(ROUTES[0]), "{", content_type="application/json", REMOTE_ADDR="192.0.2.1",
        ).status_code, 400)
        self.assertEqual(self.post(ROUTES[1], []).status_code, 400)
        self.assertEqual(self.post(ROUTES[2]).status_code, 400)
        with patch("apps.users.views.verify_challenge") as verify, \
             patch("apps.users.views.consume_password_reset_token") as consume:
            for route in ROUTES:
                self.assertLimited(self.client.post(
                    reverse(route), "{", content_type="application/json", REMOTE_ADDR="192.0.2.1",
                ))
        verify.assert_not_called()
        consume.assert_not_called()
        bucket = LoginRateLimit.objects.get()
        self.assertEqual(bucket.attempts, 3)
        self.assertRegex(bucket.key, r"^[0-9a-f]{64}$")
        self.assertFalse(User.objects.exists())

    def test_rotating_emails_and_reset_tokens_does_not_reset_ip_budget(self):
        self.assertEqual(self.post(ROUTES[0], {"email": "one@example.com", "code": "4821"}).status_code, 400)
        self.assertEqual(self.post(ROUTES[1], {"email": "two@example.com", "code": "4821"}).status_code, 400)
        self.assertEqual(self.post(ROUTES[2], {
            "token": "invalid-token", "password": "NewSecure2", "password_confirm": "NewSecure2",
        }).status_code, 400)
        self.assertLimited(self.post(ROUTES[0], {"email": "three@example.com", "code": "1234"}))
        self.assertEqual(LoginRateLimit.objects.get().attempts, 3)

    @override_settings(AUTH_VERIFY_IP_MAX_ATTEMPTS=1)
    def test_registration_is_not_activated_or_code_consumed_while_ip_is_blocked(self):
        user, challenge = self.challenge(VerificationCode.Purpose.REGISTRATION)
        now = timezone.now()
        payload = {"email": user.email, "code": "4821"}
        with patch("apps.users.throttles.timezone.now", return_value=now):
            self.assertEqual(self.post(ROUTES[1]).status_code, 400)
            self.assertLimited(self.post(ROUTES[0], payload), 60)
        user.refresh_from_db()
        challenge.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertIsNone(challenge.consumed_at)
        self.assertIsNone(challenge.verified_at)
        self.assertEqual(challenge.attempts, 0)
        self.assertFalse(AuthSession.objects.exists())
        with patch("apps.users.throttles.timezone.now", return_value=now + timedelta(seconds=10.1)):
            self.assertLimited(self.post(ROUTES[2]), 50)
        with patch("apps.users.throttles.timezone.now", return_value=now + timedelta(seconds=60)):
            self.assertEqual(self.post(ROUTES[0], payload).status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertEqual(AuthSession.objects.count(), 1)

    @override_settings(AUTH_VERIFY_IP_MAX_ATTEMPTS=1)
    def test_blocked_reset_verification_does_not_verify_challenge_or_issue_token(self):
        user, challenge = self.challenge(VerificationCode.Purpose.PASSWORD_RESET)
        self.post(ROUTES[0])
        self.assertLimited(self.post(ROUTES[1], {"email": user.email, "code": "4821"}))
        challenge.refresh_from_db()
        self.assertIsNone(challenge.verified_at)
        self.assertIsNone(challenge.consumed_at)
        self.assertEqual(challenge.attempts, 0)

    @override_settings(AUTH_VERIFY_IP_MAX_ATTEMPTS=1)
    def test_blocked_reset_confirmation_preserves_password_and_reset_token(self):
        user, challenge = self.challenge(VerificationCode.Purpose.PASSWORD_RESET, verified=True)
        original_password = user.password
        payload = {"token": create_password_reset_token(challenge),
                   "password": "NewSecure2", "password_confirm": "NewSecure2"}
        self.post(ROUTES[0])
        self.assertLimited(self.post(ROUTES[2], payload))
        user.refresh_from_db()
        challenge.refresh_from_db()
        self.assertEqual(user.password, original_password)
        self.assertIsNone(challenge.consumed_at)
        # Another visitor has an independent budget; the blocked attempt did not burn the token.
        self.assertEqual(self.post(ROUTES[2], payload, ip="192.0.2.2").status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password("NewSecure2"))

    def test_successful_reset_steps_count_and_reset_token_remains_single_use(self):
        user, challenge = self.challenge(VerificationCode.Purpose.PASSWORD_RESET)
        verified = self.post(ROUTES[1], {"email": user.email, "code": "4821"})
        self.assertEqual(verified.status_code, 200)
        payload = {"token": verified.data["reset_token"],
                   "password": "NewSecure2", "password_confirm": "NewSecure2"}
        self.assertEqual(self.post(ROUTES[2], payload).status_code, 200)
        self.assertEqual(self.post(ROUTES[2], payload).status_code, 400)
        self.assertLimited(self.post(ROUTES[0]))
        challenge.refresh_from_db()
        self.assertIsNotNone(challenge.consumed_at)
        self.assertEqual(LoginRateLimit.objects.get().attempts, 3)

    @override_settings(AUTH_CODE_MAX_ATTEMPTS=2)
    def test_code_attempt_ceiling_still_applies_across_different_ips(self):
        user, challenge = self.challenge(VerificationCode.Purpose.PASSWORD_RESET)
        for ip in ("192.0.2.1", "192.0.2.2"):
            self.assertEqual(self.post(ROUTES[1], {"email": user.email, "code": "0000"}, ip=ip).status_code, 400)
        response = self.post(ROUTES[1], {"email": user.email, "code": "4821"}, ip="192.0.2.3")
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("reset_token", response.data)
        challenge.refresh_from_db()
        self.assertEqual(challenge.attempts, 2)
        self.assertIsNone(challenge.verified_at)

    @override_settings(AUTH_VERIFY_IP_MAX_ATTEMPTS=1)
    def test_view_transaction_failure_rolls_back_account_but_keeps_ip_slot(self):
        user, challenge = self.challenge(VerificationCode.Purpose.REGISTRATION)
        payload = {"email": user.email, "code": "4821"}
        with patch("apps.users.views.token_payload", side_effect=RuntimeError("Session failure")):
            with self.assertRaises(RuntimeError):
                self.post(ROUTES[0], payload)
        user.refresh_from_db()
        challenge.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertIsNone(challenge.consumed_at)
        self.assertIsNone(challenge.verified_at)
        self.assertEqual(LoginRateLimit.objects.get().attempts, 1)
        self.assertLimited(self.post(ROUTES[0], payload))

    @override_settings(AUTH_VERIFY_IP_MAX_ATTEMPTS=1)
    def test_password_login_social_login_and_code_sends_have_separate_budgets(self):
        self.assertEqual(self.post().status_code, 400)
        self.assertLimited(self.post(ROUTES[1], HTTP_X_FORWARDED_FOR="203.0.113.1",
                                      HTTP_X_REAL_IP="203.0.113.2"))
        self.assertEqual(self.post("auth-login").status_code, 401)
        self.assertEqual(self.post("auth-google").status_code, 400)
        self.assertEqual(self.post("auth-verification-resend").status_code, 400)
        self.assertEqual(self.post(ip="192.0.2.2").status_code, 400)

    @override_settings(LOGIN_CLIENT_IP_SOURCE="railway", AUTH_VERIFY_IP_MAX_ATTEMPTS=1)
    def test_railway_edge_ip_separates_visitors_and_ignores_forwarded_spoofs(self):
        self.assertEqual(self.post(ip="10.0.0.2", HTTP_X_REAL_IP="192.0.2.1").status_code, 400)
        self.assertLimited(self.post(ROUTES[2], ip="10.0.0.2", HTTP_X_REAL_IP="::ffff:192.0.2.1",
                                      HTTP_X_FORWARDED_FOR="203.0.113.1"))
        self.assertEqual(self.post(ROUTES[1], ip="10.0.0.2", HTTP_X_REAL_IP="192.0.2.2").status_code, 400)

    def test_metadata_requests_do_not_consume_attempts(self):
        for route in ROUTES:
            self.assertEqual(self.client.get(reverse(route)).status_code, 405)
            self.assertEqual(self.client.options(reverse(route)).status_code, 200)
        self.assertFalse(LoginRateLimit.objects.exists())


@override_settings(
    LOGIN_CLIENT_IP_SOURCE="trusted-proxy", LOGIN_TRUSTED_PROXY_CIDRS=[],
    AUTH_VERIFY_IP_MAX_ATTEMPTS=3, AUTH_VERIFY_IP_WINDOW_SECONDS=60,
    AUTH_MAINTENANCE_ENABLED=False,
)
class VerificationAttemptConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_parallel_first_requests_across_all_three_routes_cannot_exceed_budget(self):
        barrier = Barrier(9)

        def attempt(index):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return APIClient().post(
                    reverse(ROUTES[index % len(ROUTES)]), {},
                    format="json", REMOTE_ADDR="192.0.2.1",
                ).status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=9) as executor:
            statuses = list(executor.map(attempt, range(9)))
        self.assertEqual(sorted(statuses), [400] * 3 + [429] * 6)
        self.assertEqual(LoginRateLimit.objects.get().attempts, 3)
        self.assertFalse(User.objects.exists())
        self.assertFalse(AuthSession.objects.exists())


class VerificationAttemptSettingsTests(SimpleTestCase):
    def test_disabled_or_negative_limits_fail_configuration_checks(self):
        for name in ("AUTH_VERIFY_IP_MAX_ATTEMPTS", "AUTH_VERIFY_IP_WINDOW_SECONDS"):
            for value in (0, -1):
                with self.subTest(name=name, value=value), override_settings(**{name: value}):
                    self.assertIn("users.E009", [error.id for error in verification_attempt_checks(None)])
