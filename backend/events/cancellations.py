"""Event cancellation and its financial/notification outbox commit together.

All ticket purchase, payment and check-in paths lock the event before their
order/ticket rows. A late successful payment queues a refund without issuing QR
tickets. Refund requests intentionally leave payment accounting unchanged.
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from ticketing.models import Order, Payment, RefundRequest, Ticket, TicketType
from .models import Event, EventCancellation, Notification


def notify_cancellation(event, user_id, *, refund=False):
    kind = Notification.Type.REFUND_PENDING if refund else Notification.Type.EVENT_CANCELLED
    message = (
        'Tədbir ləğv edildi. Biletlər etibarsızdır. Geri ödəniş sorğunuz yaradılıb və komandanın emalını gözləyir. Məbləğ hələ qaytarılmayıb.'
        if refund else 'Tədbir ləğv edildi. Biletləriniz etibarsızdır.'
    )
    Notification.objects.get_or_create(user_id=user_id, event=event, type=kind, defaults={
        'title': 'Geri ödəniş gözlənilir' if refund else 'Tədbir ləğv edildi',
        'body': message, 'organizer_id': event.organizer_id,
    })


def queue_cancellation_refund(event, order, *, paid_amount=None):
    # Use prices captured at purchase, never the current ticket catalogue price.
    if order.payments.filter(status=Payment.Status.REFUNDED).exists() and not order.payments.filter(status=Payment.Status.SUCCEEDED).exists():
        return False
    items = order.items.filter(ticket_type__event=event).annotate(
        refunded_count=Count('tickets', filter=Q(tickets__status=Ticket.Status.REFUNDED))
    )
    amount = sum((item.unit_price * max(0, item.quantity - item.refunded_count) for item in items), Decimal('0.00'))
    amount = min(amount, order.total_amount if paid_amount is None else paid_amount)
    if amount <= 0 or order.status == Order.Status.REFUNDED:
        return False
    RefundRequest.objects.get_or_create(event=event, order=order, defaults={'amount': amount, 'currency': order.currency})
    notify_cancellation(event, order.buyer_id, refund=True)
    return True


@transaction.atomic
def cancel_event(*, event_id, author, reason):
    reason = reason.strip()
    if not reason or len(reason) > 2000:
        raise ValidationError({'detail': 'Dayandırma səbəbini yaz (maksimum 2000 simvol).'})
    event = Event.objects.select_for_update().get(pk=event_id)
    if event.status != Event.Status.PUBLISHED:
        raise ValidationError({'detail': 'Yalnız yayımlanmış tədbir dayandırıla bilər.'})
    EventCancellation.objects.create(event=event, author=author, reason=reason)
    event.status = Event.Status.CANCELLED
    event.save(update_fields=['status', 'updated_at'])
    TicketType.objects.filter(event=event).update(is_active=False, updated_at=timezone.now())

    orders = list(Order.objects.select_for_update().filter(
        pk__in=Order.objects.filter(items__ticket_type__event=event).values('pk')
    ).order_by('pk'))
    active_tickets = Ticket.objects.filter(event=event, status__in=[Ticket.Status.VALID, Ticket.Status.USED])
    recipients = set(active_tickets.values_list('owner_id', flat=True))
    refund_buyers = set()
    for order in orders:
        # Paid orders stay paid until a provider actually confirms a refund.
        if order.status == Order.Status.PAID:
            recipients.add(order.buyer_id)
            if queue_cancellation_refund(event, order):
                refund_buyers.add(order.buyer_id)
        elif order.status == Order.Status.PENDING:
            order.status = Order.Status.CANCELLED
            order.save(update_fields=['status', 'updated_at'])
    active_tickets.update(status=Ticket.Status.CANCELLED)
    for user_id in recipients - refund_buyers:
        notify_cancellation(event, user_id)
    return event
