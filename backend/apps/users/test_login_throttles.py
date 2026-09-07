from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from io import StringIO
from threading import Barrier
from unittest.mock import patch

from django.core.management import call_command
from django.db import close_old_connections
from django.test import SimpleTestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.test.client import RequestFactory
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import LoginRateLimit, User
from .throttles import client_ip, consume_attempt


@override_settings(
    LOGIN_IP_MAX_ATTEMPTS=3, LOGIN_IP_WINDOW_SECONDS=60,
    LOGIN_ACCOUNT_MAX_ATTEMPTS=2, LOGIN_ACCOUNT_WINDOW_SECONDS=300,
    LOGIN_TRUSTED_PROXY_CIDRS=[],
)
class LoginThrottleTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="login@example.com", phone_number="+994501234567",
            password="SecurePass1",
        )

    def login(self, identifier="login@example.com", password="wrong", ip="192.0.2.1", **headers):
        return self.client.post(
            reverse("auth-login"),
            {"identifier": identifier, "password": password},
            format="json", REMOTE_ADDR=ip, **headers,
        )

    def test_account_limit_combines_email_phone_and_different_ips(self):
        self.assertEqual(self.login(" LOGIN@EXAMPLE.COM ").status_code, 401)
        self.assertEqual(self.login("+994 (50) 123-45-67", ip="192.0.2.2").status_code, 401)
        with patch.object(User, "check_password") as check_password:
            response = self.login(password="SecurePass1", ip="192.0.2.3")
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response["Retry-After"]), 0)
        self.assertEqual(response.data["retry_after"], int(response["Retry-After"]))
        self.assertNotIn("access", response.data)
        check_password.assert_not_called()

    def test_ip_limit_combines_accounts_and_ignores_spoofed_headers(self):
        for index in range(3):
            response = self.login(
                f"unknown{index}@example.com",
                HTTP_X_FORWARDED_FOR=f"198.51.100.{index + 1}",
            )
            self.assertEqual(response.status_code, 401)
        response = self.login(password="SecurePass1", HTTP_X_FORWARDED_FOR="203.0.113.9")
        self.assertEqual(response.status_code, 429)
        self.assertLessEqual(int(response["Retry-After"]), 60)

    def test_expiry_restores_login_without_extending_block(self):
        now = timezone.now()
        with patch("apps.users.throttles.timezone.now", return_value=now):
            self.login()
            self.login()
            response = self.login()
            self.assertEqual(response.status_code, 429)
            self.assertEqual(int(response["Retry-After"]), 300)
        with patch("apps.users.throttles.timezone.now", return_value=now + timedelta(seconds=301)):
            self.assertEqual(self.login(password="SecurePass1").status_code, 200)

    def test_other_account_and_ip_are_independent(self):
        self.login()
        self.login()
        self.assertEqual(self.login().status_code, 429)
        other = User.objects.create_user(email="other@example.com", password="SecurePass1")
        self.assertEqual(self.login(other.email, "SecurePass1", "192.0.2.2").status_code, 200)

    def test_unknown_identifier_has_same_limit_and_normalization(self):
        self.assertEqual(self.login(" UNKNOWN@EXAMPLE.COM ", ip="192.0.2.1").status_code, 401)
        self.assertEqual(self.login("unknown@example.com", ip="192.0.2.2").status_code, 401)
        response = self.login("unknown@example.com", ip="192.0.2.3")
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response["Retry-After"]), 0)

    def test_successful_attempts_also_count(self):
        self.assertEqual(self.login(password="SecurePass1").status_code, 200)
        self.assertEqual(self.login(password="SecurePass1").status_code, 200)
        self.assertEqual(self.login(password="SecurePass1").status_code, 429)

    def test_invalid_fields_still_consume_ip_budget(self):
        for _ in range(3):
            response = self.client.post(reverse("auth-login"), {}, format="json", REMOTE_ADDR="192.0.2.1")
            self.assertEqual(response.status_code, 401)
        self.assertEqual(self.login().status_code, 429)

    def test_counter_keys_do_not_contain_raw_identifiers(self):
        self.login()
        keys = list(LoginRateLimit.objects.values_list("key", flat=True))
        self.assertEqual(len(keys), 2)
        for key in keys:
            self.assertRegex(key, r"^[0-9a-f]{64}$")
            self.assertNotIn(self.user.email, key)
            self.assertNotIn("192.0.2.1", key)

    def test_cleanup_preserves_current_buckets(self):
        self.login()
        LoginRateLimit.objects.create(key="expired", expires_at=timezone.now() - timedelta(days=2))
        call_command("prune_login_rate_limits", stdout=StringIO())
        self.assertEqual(LoginRateLimit.objects.count(), 2)


class ClientIpTests(SimpleTestCase):
    @override_settings(LOGIN_TRUSTED_PROXY_CIDRS=["10.0.0.0/24"])
    def test_trusted_chain_stops_at_nearest_untrusted_address(self):
        request = RequestFactory().post(
            "/", REMOTE_ADDR="10.0.0.2",
            HTTP_X_FORWARDED_FOR="203.0.113.99, 192.0.2.1, 10.0.0.1",
        )
        self.assertEqual(client_ip(request), "192.0.2.1")

    @override_settings(LOGIN_TRUSTED_PROXY_CIDRS=["10.0.0.0/24"])
    def test_bad_forwarded_chain_falls_back_to_peer(self):
        request = RequestFactory().post("/", REMOTE_ADDR="10.0.0.2", HTTP_X_FORWARDED_FOR="invalid")
        self.assertEqual(client_ip(request), "10.0.0.2")

    @override_settings(LOGIN_TRUSTED_PROXY_CIDRS=[])
    def test_ipv6_forms_are_canonicalized(self):
        request = RequestFactory().post("/", REMOTE_ADDR="2001:0db8:0000:0000:0000:0000:0000:0001")
        self.assertEqual(client_ip(request), "2001:db8::1")
        request.META["REMOTE_ADDR"] = "::ffff:192.0.2.1"
        self.assertEqual(client_ip(request), "192.0.2.1")


class LoginThrottleConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_parallel_first_requests_cannot_exceed_bucket_limit(self):
        barrier = Barrier(8)

        def attempt(_):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return consume_attempt("test", "same-account", 3, 60)
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=8) as executor:
            waits = list(executor.map(attempt, range(8)))
        self.assertEqual(waits.count(0), 3)
        self.assertTrue(all(wait > 0 for wait in waits if wait != 0))
        self.assertEqual(LoginRateLimit.objects.get().attempts, 3)


@override_settings(LOGIN_CLIENT_IP_SOURCE="railway", LOGIN_TRUSTED_PROXY_CIDRS=[])
class RailwayClientIpTests(SimpleTestCase):
    def test_edge_header_is_authoritative_and_canonical(self):
        for header, expected in [
            ("192.0.2.1", "192.0.2.1"),
            (" 2001:0db8:0:0:0:0:0:1 ", "2001:db8::1"),
            ("::ffff:192.0.2.1", "192.0.2.1"),
        ]:
            with self.subTest(header=header):
                request = RequestFactory().post(
                    "/", REMOTE_ADDR="10.0.0.2", HTTP_X_REAL_IP=header,
                    HTTP_X_FORWARDED_FOR="203.0.113.99", HTTP_CF_CONNECTING_IP="203.0.113.98",
                )
                self.assertEqual(client_ip(request), expected)

    def test_missing_or_invalid_edge_header_falls_back_only_to_peer(self):
        for header in ["", "invalid", "192.0.2.1, 192.0.2.2", "192.0.2.1:443",
                       "[2001:db8::1]", "fe80::1%eth0", "x" * 65]:
            with self.subTest(header=header):
                request = RequestFactory().post(
                    "/", REMOTE_ADDR="10.0.0.2", HTTP_X_REAL_IP=header,
                    HTTP_X_FORWARDED_FOR="203.0.113.99",
                )
                self.assertEqual(client_ip(request), "10.0.0.2")

    @override_settings(LOGIN_CLIENT_IP_SOURCE="trusted-proxy")
    def test_unconfigured_deployments_ignore_real_ip_header(self):
        request = RequestFactory().post(
            "/", REMOTE_ADDR="192.0.2.1", HTTP_X_REAL_IP="203.0.113.99",
        )
        self.assertEqual(client_ip(request), "192.0.2.1")

    def test_invalid_peer_is_not_rescued_by_headers(self):
        request = RequestFactory().post("/", REMOTE_ADDR="invalid", HTTP_X_REAL_IP="192.0.2.1")
        self.assertEqual(client_ip(request), "unknown")


@override_settings(
    LOGIN_CLIENT_IP_SOURCE="railway", LOGIN_TRUSTED_PROXY_CIDRS=[],
    LOGIN_IP_MAX_ATTEMPTS=2, LOGIN_ACCOUNT_MAX_ATTEMPTS=10,
)
class RailwayLoginBudgetTests(APITestCase):
    def attempt(self, ip, spoof):
        # Invalid payloads exercise the IP budget without creating an account.
        return self.client.post(
            reverse("auth-login"), {}, format="json", REMOTE_ADDR="10.0.0.2",
            HTTP_X_REAL_IP=ip, HTTP_X_FORWARDED_FOR=spoof,
        )

    def test_visitors_behind_one_peer_have_independent_budgets(self):
        self.assertEqual(self.attempt("192.0.2.1", "203.0.113.1").status_code, 401)
        self.assertEqual(self.attempt("::ffff:192.0.2.1", "203.0.113.2").status_code, 401)
        self.assertEqual(self.attempt("192.0.2.1", "203.0.113.3").status_code, 429)
        self.assertEqual(self.attempt("192.0.2.2", "203.0.113.3").status_code, 401)
