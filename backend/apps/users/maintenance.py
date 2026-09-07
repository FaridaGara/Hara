"""Small, traffic-triggered cleanup batches; no separate worker or scheduler."""

from datetime import timedelta
import logging
from threading import Lock
from time import monotonic

from django.conf import settings
from django.db import connection, transaction
from django.utils import timezone

from .models import AuthSession, LoginRateLimit

logger = logging.getLogger(__name__)


def prune_batch(model, cutoff, batch_size):
    """Lock and recheck expiry so a concurrently renewed counter is retained."""
    with transaction.atomic():
        if connection.vendor == "postgresql":
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '250ms'")
                cursor.execute("SET LOCAL statement_timeout = '1000ms'")
        rows = model.objects.filter(expires_at__lt=cutoff).order_by("expires_at", "pk")
        if connection.features.has_select_for_update_skip_locked:
            rows = rows.select_for_update(skip_locked=True)
        elif connection.features.has_select_for_update:
            rows = rows.select_for_update()
        ids = list(rows.values_list("pk", flat=True)[:batch_size])
        if not ids:
            return 0
        deleted, _ = model.objects.filter(pk__in=ids, expires_at__lt=cutoff).delete()
        return deleted


class AuthMaintenanceMiddleware:
    """Run at most one small pass per process interval after an auth response.

    Idle services do no work. A full batch or an error retries on later traffic;
    other requests do not wait on the local maintenance lock.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self._lock = Lock()
        self._next_run = 0.0

    def __call__(self, request):
        response = self.get_response(request)
        if (
            settings.AUTH_MAINTENANCE_ENABLED
            and request.method == "POST"
            and request.path_info.startswith("/api/auth/")
            and response.status_code < 500
        ):
            self.run_if_due()
        return response

    def run_if_due(self):
        if monotonic() < self._next_run or not self._lock.acquire(blocking=False):
            return
        try:
            if monotonic() < self._next_run:
                return
            # A failed pass must not cause every incoming request to retry it.
            delay = 300
            try:
                cutoff = timezone.now() - timedelta(days=1)
                batch_size = 200
                counts = [prune_batch(model, cutoff, batch_size)
                          for model in (AuthSession, LoginRateLimit)]
                delay = 60 if max(counts) == batch_size else 86400
                if sum(counts):
                    logger.info("Auth cleanup: sessions=%d counters=%d", *counts)
            except Exception as exc:
                # Never expose SQL parameters, tokens, or account identifiers.
                logger.warning("Auth cleanup deferred (%s)", type(exc).__name__)
            finally:
                self._next_run = monotonic() + delay
        finally:
            self._lock.release()
