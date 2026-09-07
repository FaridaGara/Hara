from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from unittest.mock import patch

from django.db import close_old_connections, transaction
from django.http import HttpResponse
from django.test import RequestFactory, TestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.utils import timezone

from .maintenance import AuthMaintenanceMiddleware, prune_batch
from .models import AuthSession, LoginRateLimit, User


class PruneBatchTests(TestCase):
    def test_only_records_expired_more_than_a_day_are_deleted(self):
        now = timezone.now()
        user = User.objects.create_user(email="maintenance@example.com", password="unused")
        old = AuthSession.objects.create(user=user, refresh_jti="old", expires_at=now-timedelta(days=2))
        recent = AuthSession.objects.create(user=user, refresh_jti="recent", expires_at=now-timedelta(hours=1))
        revoked = AuthSession.objects.create(user=user, refresh_jti="revoked", expires_at=now+timedelta(days=1), revoked_at=now)
        cutoff = now - timedelta(days=1)
        boundary = AuthSession.objects.create(user=user, refresh_jti="boundary", expires_at=cutoff)
        self.assertEqual(prune_batch(AuthSession, cutoff, 200), 1)
        self.assertFalse(AuthSession.objects.filter(pk=old.pk).exists())
        self.assertEqual(set(AuthSession.objects.values_list("pk", flat=True)), {recent.pk, revoked.pk, boundary.pk})

    def test_counter_batch_is_bounded_and_preserves_current_counters(self):
        now = timezone.now()
        for i in range(5):
            LoginRateLimit.objects.create(key=str(i), attempts=3, expires_at=now-timedelta(days=2))
        LoginRateLimit.objects.create(key="current", attempts=3, expires_at=now+timedelta(minutes=5))
        self.assertEqual(prune_batch(LoginRateLimit, now-timedelta(days=1), 2), 2)
        self.assertEqual(LoginRateLimit.objects.count(), 4)
        self.assertEqual(LoginRateLimit.objects.get(pk="current").attempts, 3)


@override_settings(AUTH_MAINTENANCE_ENABLED=True)
class MaintenanceMiddlewareTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.response = HttpResponse(status=401)
        self.middleware = AuthMaintenanceMiddleware(lambda request: self.response)

    @patch("apps.users.maintenance.prune_batch", return_value=0)
    @patch("apps.users.maintenance.monotonic", return_value=100)
    def test_once_per_interval_and_only_after_auth_post(self, clock, prune):
        self.middleware(self.factory.get("/api/auth/login/"))
        self.middleware(self.factory.post("/api/events/"))
        prune.assert_not_called()
        self.assertIs(self.middleware(self.factory.post("/api/auth/login/")), self.response)
        self.middleware(self.factory.post("/api/auth/logout/"))
        self.assertEqual(prune.call_count, 2)
        clock.return_value = 86500
        self.middleware(self.factory.post("/api/auth/refresh/"))
        self.assertEqual(prune.call_count, 4)

    @patch("apps.users.maintenance.prune_batch", return_value=200)
    @patch("apps.users.maintenance.monotonic", return_value=100)
    def test_backlog_retries_after_a_minute(self, clock, prune):
        self.middleware(self.factory.post("/api/auth/login/"))
        self.assertEqual(self.middleware._next_run, 160)
        clock.return_value = 159
        self.middleware(self.factory.post("/api/auth/login/"))
        self.assertEqual(prune.call_count, 2)
        clock.return_value = 160
        self.middleware(self.factory.post("/api/auth/login/"))
        self.assertEqual(prune.call_count, 4)

    @patch("apps.users.maintenance.prune_batch", side_effect=RuntimeError("sensitive SQL details"))
    @patch("apps.users.maintenance.monotonic", return_value=100)
    def test_cleanup_failure_preserves_response_and_backs_off(self, clock, prune):
        with self.assertLogs("apps.users.maintenance", level="WARNING") as logs:
            self.assertIs(self.middleware(self.factory.post("/api/auth/login/")), self.response)
        self.assertNotIn("sensitive SQL details", str(logs.output))
        self.assertEqual(self.middleware._next_run, 400)
        self.middleware(self.factory.post("/api/auth/login/"))
        self.assertEqual(prune.call_count, 1)

    @patch("apps.users.maintenance.prune_batch")
    def test_busy_lock_does_not_delay_other_requests(self, prune):
        self.middleware._lock.acquire()
        try:
            self.assertIs(self.middleware(self.factory.post("/api/auth/login/")), self.response)
            prune.assert_not_called()
        finally:
            self.middleware._lock.release()

    @patch("apps.users.maintenance.prune_batch")
    def test_disabled_or_server_error_skips_cleanup(self, prune):
        with override_settings(AUTH_MAINTENANCE_ENABLED=False):
            self.middleware(self.factory.post("/api/auth/login/"))
        self.response.status_code = 500
        self.middleware(self.factory.post("/api/auth/login/"))
        prune.assert_not_called()


class CleanupConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update_skip_locked")
    def test_cleanup_skips_counter_being_renewed(self):
        now = timezone.now()
        LoginRateLimit.objects.create(key="renewing", expires_at=now-timedelta(days=2))
        LoginRateLimit.objects.create(key="expired", expires_at=now-timedelta(days=2))
        locked, release = Event(), Event()

        def renew():
            close_old_connections()
            try:
                with transaction.atomic():
                    row = LoginRateLimit.objects.select_for_update().get(pk="renewing")
                    locked.set()
                    if not release.wait(10):
                        raise RuntimeError("test renewal timed out")
                    row.expires_at = now + timedelta(minutes=5)
                    row.save(update_fields=["expires_at"])
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(renew)
            try:
                self.assertTrue(locked.wait(10))
                self.assertEqual(prune_batch(LoginRateLimit, now-timedelta(days=1), 200), 1)
            finally:
                release.set()
            future.result(timeout=10)
        self.assertEqual(LoginRateLimit.objects.get(pk="renewing").expires_at, now+timedelta(minutes=5))
