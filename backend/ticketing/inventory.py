from dataclasses import dataclass

from django.db.models import (
    F,
    IntegerField,
    Q,
    Sum,
    Value,
)
from django.db.models.functions import Coalesce, Greatest
from django.utils import timezone

from .models import Order, OrderItem


@dataclass(frozen=True)
class InventorySnapshot:
    capacity: int
    reserved_quantity: int
    sold_quantity: int
    available_quantity: int


def inventory_quantities(ticket_type_ids, now=None):
    now = now or timezone.now()
    rows = (
        OrderItem.objects
        .filter(ticket_type_id__in=ticket_type_ids)
        .values("ticket_type_id")
        .annotate(
            reserved_quantity=Coalesce(
                Sum(
                    "quantity",
                    filter=Q(
                        order__status=Order.Status.PENDING,
                        order__expires_at__gt=now,
                    ),
                ),
                Value(0),
                output_field=IntegerField(),
            ),
            sold_quantity=Coalesce(
                Sum(
                    "quantity",
                    filter=Q(order__status=Order.Status.PAID),
                ),
                Value(0),
                output_field=IntegerField(),
            ),
        )
    )
    return {
        row["ticket_type_id"]: {
            "reserved_quantity": row["reserved_quantity"],
            "sold_quantity": row["sold_quantity"],
        }
        for row in rows
    }


def get_inventory_snapshot(ticket_type, now=None):
    quantities = inventory_quantities(
        [ticket_type.pk],
        now=now,
    ).get(
        ticket_type.pk,
        {
            "reserved_quantity": 0,
            "sold_quantity": 0,
        },
    )
    available_quantity = max(
        ticket_type.capacity
        - quantities["reserved_quantity"]
        - quantities["sold_quantity"],
        0,
    )
    return InventorySnapshot(
        capacity=ticket_type.capacity,
        reserved_quantity=quantities["reserved_quantity"],
        sold_quantity=quantities["sold_quantity"],
        available_quantity=available_quantity,
    )


def annotate_inventory(queryset, now=None):
    now = now or timezone.now()
    zero = Value(0, output_field=IntegerField())
    queryset = queryset.annotate(
        reserved_quantity=Coalesce(
            Sum(
                "order_items__quantity",
                filter=Q(
                    order_items__order__status=Order.Status.PENDING,
                    order_items__order__expires_at__gt=now,
                ),
            ),
            zero,
            output_field=IntegerField(),
        ),
        sold_quantity=Coalesce(
            Sum(
                "order_items__quantity",
                filter=Q(
                    order_items__order__status=Order.Status.PAID,
                ),
            ),
            zero,
            output_field=IntegerField(),
        ),
    )
    return queryset.annotate(
        available_quantity=Greatest(
            F("capacity")
            - F("reserved_quantity")
            - F("sold_quantity"),
            zero,
        )
    )
