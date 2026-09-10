from events.models import Event
from .models import OrderItem


def lock_order_events(order_id):
    """Must be called inside atomic(), before locking the order or payment."""
    return list(Event.objects.select_for_update().filter(
        pk__in=OrderItem.objects.filter(order_id=order_id).values('ticket_type__event_id')
    ).order_by('pk'))
