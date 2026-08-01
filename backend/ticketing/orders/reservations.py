import hashlib
import json
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from events.models import Event

from ticketing.inventory import inventory_quantities
from ticketing.models import (
    Order,
    OrderIdempotencyKey,
    OrderItem,
    TicketType,
)


class OrderReservationError(Exception):
    def __init__(
        self,
        detail,
        *,
        status_code,
        code=None,
        **extra,
    ):
        super().__init__(detail)
        self.status_code = status_code
        self.payload = {"detail": detail}

        if code:
            self.payload["code"] = code

        self.payload.update(extra)


@dataclass(frozen=True)
class OrderReservationResult:
    order: Order
    created: bool


def canonical_order_fingerprint(items):
    canonical_items = sorted(
        (
            {
                "ticket_type_id": item["ticket_type_id"],
                "quantity": item["quantity"],
            }
            for item in items
        ),
        key=lambda item: item["ticket_type_id"],
    )
    canonical_payload = json.dumps(
        canonical_items,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(canonical_payload).hexdigest()


def _claim_idempotency_key(
    *,
    buyer,
    key,
    request_fingerprint,
):
    try:
        with transaction.atomic():
            record = OrderIdempotencyKey.objects.create(
                buyer=buyer,
                key=key,
                request_fingerprint=request_fingerprint,
            )
    except IntegrityError:
        record = (
            OrderIdempotencyKey.objects
            .select_related("order")
            .get(buyer=buyer, key=key)
        )

        if record.request_fingerprint != request_fingerprint:
            raise OrderReservationError(
                "Bu Idempotency-Key fərqli sorğu üçün istifadə olunub.",
                status_code=409,
                code="IDEMPOTENCY_KEY_REUSED",
            )

        if record.order is None:
            raise OrderReservationError(
                "Bu sorğu artıq emal olunur.",
                status_code=409,
                code="IDEMPOTENCY_REQUEST_IN_PROGRESS",
            )

        return None, record.order

    return record, None


@transaction.atomic
def reserve_order(*, buyer, items, idempotency_key=None):
    request_fingerprint = canonical_order_fingerprint(items)
    idempotency_record = None

    if idempotency_key is not None:
        idempotency_record, existing_order = _claim_idempotency_key(
            buyer=buyer,
            key=idempotency_key,
            request_fingerprint=request_fingerprint,
        )

        if existing_order is not None:
            return OrderReservationResult(
                order=existing_order,
                created=False,
            )

    quantities = {
        item["ticket_type_id"]: item["quantity"]
        for item in items
    }
    ticket_type_ids = sorted(quantities)
    locked_ticket_types = list(
        TicketType.objects
        .select_for_update()
        .select_related("event")
        .filter(id__in=ticket_type_ids)
        .order_by("id")
    )

    if len(locked_ticket_types) != len(ticket_type_ids):
        raise OrderReservationError(
            "Bilet növlərindən biri tapılmadı.",
            status_code=400,
        )

    event_ids = {
        ticket_type.event_id
        for ticket_type in locked_ticket_types
    }

    if len(event_ids) != 1:
        raise OrderReservationError(
            (
                "Bir sifariş yalnız bir tədbirə aid "
                "biletlərdən ibarət ola bilər."
            ),
            status_code=400,
        )

    now = timezone.now()
    event = locked_ticket_types[0].event

    if event.status != Event.Status.PUBLISHED:
        raise OrderReservationError(
            "Bu tədbir hazırda satışda deyil.",
            status_code=409,
        )

    if event.start_at <= now:
        raise OrderReservationError(
            "Başlamış tədbir üçün bilet almaq olmaz.",
            status_code=409,
        )

    current_inventory = inventory_quantities(
        ticket_type_ids,
        now=now,
    )
    total_amount = Decimal("0.00")
    order_item_values = []

    for ticket_type in locked_ticket_types:
        quantity = quantities[ticket_type.id]

        if not ticket_type.is_active:
            raise OrderReservationError(
                f"“{ticket_type.name}” bilet növü aktiv deyil.",
                status_code=409,
            )

        if (
            ticket_type.sales_start_at
            and now < ticket_type.sales_start_at
        ):
            raise OrderReservationError(
                (
                    f"“{ticket_type.name}” bileti üzrə "
                    "satış hələ başlamayıb."
                ),
                status_code=409,
            )

        if (
            ticket_type.sales_end_at
            and now >= ticket_type.sales_end_at
        ):
            raise OrderReservationError(
                (
                    f"“{ticket_type.name}” bileti üzrə "
                    "satış başa çatıb."
                ),
                status_code=409,
            )

        if quantity > ticket_type.max_per_order:
            raise OrderReservationError(
                (
                    f"“{ticket_type.name}” üçün bir sifarişdə "
                    f"maksimum {ticket_type.max_per_order} "
                    "bilet almaq olar."
                ),
                status_code=400,
            )

        quantities_in_use = current_inventory.get(
            ticket_type.id,
            {
                "reserved_quantity": 0,
                "sold_quantity": 0,
            },
        )
        available_quantity = max(
            ticket_type.capacity
            - quantities_in_use["reserved_quantity"]
            - quantities_in_use["sold_quantity"],
            0,
        )

        if quantity > available_quantity:
            raise OrderReservationError(
                (
                    f"“{ticket_type.name}” üçün yalnız "
                    f"{available_quantity} bilet qalıb."
                ),
                status_code=409,
                code="INSUFFICIENT_CAPACITY",
                ticket_type_id=ticket_type.id,
                requested_quantity=quantity,
                available_quantity=available_quantity,
            )

        total_amount += ticket_type.price * quantity
        order_item_values.append(
            {
                "ticket_type": ticket_type,
                "quantity": quantity,
                "unit_price": ticket_type.price,
            }
        )

    reservation_minutes = settings.ORDER_RESERVATION_MINUTES

    if reservation_minutes <= 0:
        raise RuntimeError(
            "ORDER_RESERVATION_MINUTES müsbət olmalıdır."
        )

    order = Order.objects.create(
        buyer=buyer,
        status=Order.Status.PENDING,
        total_amount=total_amount,
        currency="AZN",
        expires_at=now + timedelta(minutes=reservation_minutes),
    )
    OrderItem.objects.bulk_create(
        [
            OrderItem(
                order=order,
                **item_values,
            )
            for item_values in order_item_values
        ]
    )

    if idempotency_record is not None:
        idempotency_record.order = order
        idempotency_record.save(update_fields=["order"])

    return OrderReservationResult(
        order=order,
        created=True,
    )
