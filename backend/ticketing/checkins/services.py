from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from ticketing.models import Order, Ticket


class TicketCheckInNotFound(Exception):
    pass


class TicketCheckInConflict(Exception):
    pass


@dataclass(frozen=True)
class TicketCheckInResult:
    ticket: Ticket
    already_checked_in: bool


def ticket_check_in_queryset():
    return Ticket.objects.select_related(
        "event",
        "event__venue",
        "owner",
        "checked_in_by",
        "order_item",
        "order_item__order",
        "order_item__ticket_type",
    )


@transaction.atomic
def check_in_ticket(*, event, qr_code, organizer):
    ticket = (
        ticket_check_in_queryset()
        .select_for_update(of=("self",))
        .filter(
            event=event,
            order_item__ticket_type__event=event,
            qr_code=qr_code,
        )
        .first()
    )

    if ticket is None:
        raise TicketCheckInNotFound

    if ticket.used_at is not None:
        return TicketCheckInResult(
            ticket=ticket,
            already_checked_in=True,
        )

    if (
        ticket.status != Ticket.Status.VALID
        or ticket.order_item.order.status != Order.Status.PAID
    ):
        raise TicketCheckInConflict(
            "Bu bilet check-in üçün etibarlı deyil."
        )

    ticket.status = Ticket.Status.USED
    ticket.used_at = timezone.now()
    ticket.checked_in_by = organizer
    ticket.save(
        update_fields=[
            "status",
            "used_at",
            "checked_in_by",
        ]
    )

    return TicketCheckInResult(
        ticket=ticket,
        already_checked_in=False,
    )
