from django.db import models
from django.utils import timezone

from events.models import Event


class TicketSalesStatus(models.TextChoices):
    UPCOMING = "UPCOMING", "Upcoming"
    AVAILABLE = "AVAILABLE", "Available"
    SOLD_OUT = "SOLD_OUT", "Sold out"
    ENDED = "ENDED", "Ended"


def get_ticket_sales_status(
    ticket_type,
    *,
    available_quantity,
    now=None,
):
    now = now or timezone.now()

    if (
        not ticket_type.is_active
        or ticket_type.event.status != Event.Status.PUBLISHED
        or ticket_type.event.start_at <= now
        or (
            ticket_type.sales_end_at is not None
            and now >= ticket_type.sales_end_at
        )
    ):
        return TicketSalesStatus.ENDED

    if (
        ticket_type.sales_start_at is not None
        and now < ticket_type.sales_start_at
    ):
        return TicketSalesStatus.UPCOMING

    if available_quantity <= 0:
        return TicketSalesStatus.SOLD_OUT

    return TicketSalesStatus.AVAILABLE
