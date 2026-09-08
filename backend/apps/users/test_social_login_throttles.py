from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from django.db import close_old_connections
from django.test import SimpleTestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from .checks import social_login_checks
from .models import AuthSession, LoginRateLimit, SocialIdentity, User
from .social_auth import SocialClaims, SocialTokenError


@override_settings(
    LOGIN_CLIENT_IP_SOURCE="trusted-proxy", LOGIN_TRUSTED_PROXY_CIDRS=[],
    SOCIAL_LOGIN_IP_MAX_ATTEMPTS=3, SOCIAL_LOGIN_IP_WINDOW_SECONDS=60,
    AUTH_MAINTENANCE_ENABLED=False,
)
class SocialLoginThrottleTests(APITestCase):
    def setUp(self):
        self.google = self.enterContext(patch(
            "apps.users.views.GoogleSocialLoginAPIView.verifier",
            side_effect=SocialTokenError("Invalid Google token."),
        ))
        self.apple = self.enterContext(patch(
            "apps.users.views.AppleSocialLoginAPIView.verifier",
            side_effect=SocialTokenError("Invalid Apple token."),
        ))

    def login(self, provider="google", ip="192.0.2.1", **headers):
        return self.client.post(
            reverse(f"auth-{provider}"),
            {"credential": "synthetic-provider-token", "nonce": "synthetic-nonce"},
            format="json", REMOTE_ADDR=ip, **headers,
        )

    def assertLimited(self, response, wait=None):
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response["Retry-After"]), 0)
        self.assertEqual(response.data["retry_after"], int(response["Retry-After"]))
        if wait is not None:
            self.assertEqual(response.data["retry_after"], wait)
        self.assertNotIn("access", response.data)
        self.assertNotIn("refresh", response.data)

    def test_providers_share_one_budget_before_token_verification(self):
        for provider in ("google", "apple", "google"):
            self.assertEqual(self.login(provider).status_code, 401)
        self.assertLimited(self.login("apple"))
        self.assertLimited(self.login("google"))
        self.assertEqual(self.google.call_count, 2)
        self.assertEqual(self.apple.call_count, 1)
        self.assertFalse(User.objects.exists())
        self.assertFalse(SocialIdentity.objects.exists())
        self.assertFalse(AuthSession.objects.exists())
        bucket = LoginRateLimit.objects.get()
        self.assertEqual(bucket.attempts, 3)
        self.assertRegex(bucket.key, r"^[0-9a-f]{64}$")

    @override_settings(SOCIAL_LOGIN_IP_MAX_ATTEMPTS=4)
    def test_invalid_bodies_and_oversized_tokens_count_before_parsing(self):
        url = reverse("auth-apple")
        self.assertEqual(self.client.post(
            url, "{", content_type="application/json", REMOTE_ADDR="192.0.2.1",
        ).status_code, 400)
        for payload in ([], {"credential": "x" * 16385, "nonce": "n"}, {"credential": "x"}):
            self.assertEqual(self.client.post(
                url, payload, format="json", REMOTE_ADDR="192.0.2.1",
            ).status_code, 400)
        # An exhausted budget rejects even malformed JSON without parsing it.
        self.assertLimited(self.client.post(
            reverse("auth-google"), "{", content_type="application/json", REMOTE_ADDR="192.0.2.1",
        ))
        self.google.assert_not_called()
        self.apple.assert_not_called()

    def test_successful_logins_consume_budget_and_denial_creates_no_session(self):
        self.google.side_effect = None
        self.google.return_value = SocialClaims(
            subject="synthetic-google-subject", email="social@example.com",
            email_verified=True, authoritative_email=True,
        )
        for _ in range(3):
            response = self.login()
            self.assertEqual(response.status_code, 200)
            self.assertIn("access", response.data)
        self.assertLimited(self.login())
        self.assertEqual(AuthSession.objects.count(), 3)
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(SocialIdentity.objects.count(), 1)
        self.assertEqual(self.google.call_count, 3)

    @override_settings(SOCIAL_LOGIN_IP_MAX_ATTEMPTS=1)
    def test_other_ips_and_password_login_have_independent_budgets(self):
        self.assertEqual(self.login().status_code, 401)
        self.assertLimited(self.login("apple", HTTP_X_FORWARDED_FOR="203.0.113.9",
                                      HTTP_X_REAL_IP="203.0.113.10"))
        self.assertEqual(self.login("apple", ip="192.0.2.2").status_code, 401)
        response = self.client.post(reverse("auth-login"), {}, format="json", REMOTE_ADDR="192.0.2.1")
        self.assertEqual(response.status_code, 401)

    def test_retry_after_decreases_and_window_recovers_without_extending_block(self):
        now = timezone.now()
        with patch("apps.users.throttles.timezone.now", return_value=now):
            for _ in range(3):
                self.assertEqual(self.login().status_code, 401)
            self.assertLimited(self.login("apple"), 60)
        with patch("apps.users.throttles.timezone.now", return_value=now + timedelta(seconds=10.1)):
            self.assertLimited(self.login(), 50)
            self.assertLimited(self.login("apple"), 50)
        with patch("apps.users.throttles.timezone.now", return_value=now + timedelta(seconds=60)):
            self.assertEqual(self.login("apple").status_code, 401)
        self.assertEqual(LoginRateLimit.objects.get().attempts, 1)

    @override_settings(SOCIAL_LOGIN_IP_MAX_ATTEMPTS=1)
    def test_provider_failure_does_not_refund_budget(self):
        self.google.side_effect = RuntimeError("Provider unavailable")
        with self.assertRaises(RuntimeError):
            self.login()
        self.assertLimited(self.login("apple"))
        self.apple.assert_not_called()
        self.assertEqual(LoginRateLimit.objects.get().attempts, 1)

    @override_settings(LOGIN_CLIENT_IP_SOURCE="railway", SOCIAL_LOGIN_IP_MAX_ATTEMPTS=1)
    def test_railway_visitors_are_separate_and_forwarded_spoofs_do_not_bypass_limit(self):
        self.assertEqual(self.login(ip="10.0.0.2", HTTP_X_REAL_IP="192.0.2.1",
                                    HTTP_X_FORWARDED_FOR="203.0.113.1").status_code, 401)
        self.assertLimited(self.login("apple", ip="10.0.0.2", HTTP_X_REAL_IP="::ffff:192.0.2.1",
                                      HTTP_X_FORWARDED_FOR="203.0.113.2"))
        self.assertEqual(self.login("apple", ip="10.0.0.2", HTTP_X_REAL_IP="192.0.2.2").status_code, 401)

    def test_get_and_options_do_not_spend_login_budget(self):
        for provider in ("google", "apple"):
            self.assertEqual(self.client.get(reverse(f"auth-{provider}")).status_code, 405)
            self.assertEqual(self.client.options(reverse(f"auth-{provider}")).status_code, 200)
        self.assertFalse(LoginRateLimit.objects.exists())
        self.google.assert_not_called()
        self.apple.assert_not_called()


@override_settings(
    LOGIN_CLIENT_IP_SOURCE="trusted-proxy", LOGIN_TRUSTED_PROXY_CIDRS=[],
    SOCIAL_LOGIN_IP_MAX_ATTEMPTS=3, SOCIAL_LOGIN_IP_WINDOW_SECONDS=60,
    AUTH_MAINTENANCE_ENABLED=False,
)
class SocialLoginConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_parallel_google_and_apple_requests_cannot_exceed_shared_limit(self):
        barrier = Barrier(8)

        def attempt(index):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                provider = "google" if index % 2 else "apple"
                return APIClient().post(
                    reverse(f"auth-{provider}"),
                    {"credential": "synthetic-token", "nonce": "synthetic-nonce"},
                    format="json", REMOTE_ADDR="192.0.2.1",
                ).status_code
            finally:
                close_old_connections()

        with patch("apps.users.views.GoogleSocialLoginAPIView.verifier",
                   side_effect=SocialTokenError("Invalid token")) as google, \
             patch("apps.users.views.AppleSocialLoginAPIView.verifier",
                   side_effect=SocialTokenError("Invalid token")) as apple:
            with ThreadPoolExecutor(max_workers=8) as executor:
                statuses = list(executor.map(attempt, range(8)))
        self.assertEqual(sorted(statuses), [401] * 3 + [429] * 5)
        self.assertEqual(google.call_count + apple.call_count, 3)
        self.assertEqual(LoginRateLimit.objects.get().attempts, 3)


class SocialLoginSettingsTests(SimpleTestCase):
    def test_disabled_or_negative_limits_fail_configuration_checks(self):
        for name in ("SOCIAL_LOGIN_IP_MAX_ATTEMPTS", "SOCIAL_LOGIN_IP_WINDOW_SECONDS"):
            for value in (0, -1):
                with self.subTest(name=name, value=value), override_settings(**{name: value}):
                    self.assertIn("users.E008", [error.id for error in social_login_checks(None)])
