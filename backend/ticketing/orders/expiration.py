from dataclasses import dataclass

from django.db import connection, transaction
from django.utils import timezone

from ticketing.models import Order


@dataclass(frozen=True)
class OrderExpirationResult:
    checked: int
    expired: int
    skipped: int


def expire_pending_orders(
    now=None,
    *,
    batch_size=500,
    order_ids=None,
    buyer_id=None,
):
    if batch_size < 1:
        raise ValueError("batch_size ən azı 1 olmalıdır.")

    now = now or timezone.now()
    checked = 0
    expired = 0
    skipped = 0

    while True:
        with transaction.atomic():
            queryset = Order.objects.filter(
                status=Order.Status.PENDING,
                expires_at__isnull=False,
                expires_at__lte=now,
            )

            if order_ids is not None:
                queryset = queryset.filter(pk__in=order_ids)

            if buyer_id is not None:
                queryset = queryset.filter(buyer_id=buyer_id)

            supports_skip_locked = (
                connection.features.has_select_for_update_skip_locked
            )
            locked_orders = list(
                queryset
                .select_for_update(skip_locked=supports_skip_locked)
                .order_by("expires_at", "id")[:batch_size]
            )

            if not locked_orders:
                break

            locked_order_ids = [
                order.pk
                for order in locked_orders
            ]
            updated = Order.objects.filter(
                pk__in=locked_order_ids,
                status=Order.Status.PENDING,
                expires_at__isnull=False,
                expires_at__lte=now,
            ).update(
                status=Order.Status.EXPIRED,
                updated_at=now,
            )
            checked += len(locked_orders)
            expired += updated
            skipped += len(locked_orders) - updated

        if len(locked_orders) < batch_size:
            break

    return OrderExpirationResult(
        checked=checked,
        expired=expired,
        skipped=skipped,
    )
