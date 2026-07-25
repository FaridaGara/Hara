from dataclasses import dataclass
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.utils import timezone

from ticketing.models import (
    Order,
    OrderItem,
    Payment,
    PaymentWebhookEvent,
    Ticket,
)
from ticketing.payments.providers.sandbox import (
    create_sandbox_payment,
)


class PaymentOrderNotFound(Exception):
    pass


class PaymentNotFound(Exception):
    pass


class PaymentPayloadMismatch(Exception):
    pass


class PaymentProviderUnavailable(Exception):
    pass


@dataclass(frozen=True)
class PaymentInitiationResult:
    payment: Payment | None
    created: bool = False
    conflict: str | None = None


@dataclass(frozen=True)
class PaymentProcessingResult:
    payment: Payment | None
    outcome: str
    conflict: str | None = None


def issue_tickets_for_order(order):
    order_items = (
        OrderItem.objects
        .select_related("ticket_type")
        .annotate(issued_ticket_count=Count("tickets"))
        .filter(order=order)
        .order_by("id")
    )
    tickets = [
        Ticket(
            order_item=order_item,
            event_id=order_item.ticket_type.event_id,
            owner_id=order.buyer_id,
        )
        for order_item in order_items
        for _ in range(
            max(
                order_item.quantity
                - order_item.issued_ticket_count,
                0,
            )
        )
    ]
    Ticket.objects.bulk_create(tickets)
    return len(tickets)


def _create_provider_payment(order):
    provider = settings.PAYMENT_PROVIDER

    if provider == "sandbox":
        if not settings.PAYMENT_SANDBOX_ENABLED:
            raise PaymentProviderUnavailable(
                "Sandbox payment provider aktiv deyil."
            )

        return create_sandbox_payment(order)

    raise PaymentProviderUnavailable(
        f"Payment provider dəstəklənmir: {provider}"
    )


def _create_free_payment(order):
    return Payment.objects.create(
        order=order,
        status=Payment.Status.SUCCEEDED,
        amount=order.total_amount,
        currency=order.currency,
        provider="free",
        provider_reference=f"free_{order.id}",
        checkout_url=None,
    )


@transaction.atomic
def initiate_payment(*, order_id, buyer):
    try:
        order = (
            Order.objects
            .select_for_update()
            .get(pk=order_id, buyer=buyer)
        )
    except Order.DoesNotExist as exc:
        raise PaymentOrderNotFound from exc

    existing_free_payment = (
        Payment.objects
        .filter(
            order=order,
            provider="free",
            status=Payment.Status.SUCCEEDED,
        )
        .first()
    )

    if (
        order.status == Order.Status.PAID
        and order.total_amount == Decimal("0.00")
        and existing_free_payment
    ):
        return PaymentInitiationResult(
            payment=existing_free_payment,
            created=False,
        )

    if order.status != Order.Status.PENDING:
        return PaymentInitiationResult(
            payment=None,
            conflict="Bu sifariş üçün ödəniş başlatmaq mümkün deyil.",
        )

    now = timezone.now()

    if order.expires_at and order.expires_at <= now:
        order.status = Order.Status.EXPIRED
        order.save(update_fields=["status", "updated_at"])
        return PaymentInitiationResult(
            payment=None,
            conflict="Sifarişin rezervasiya vaxtı bitib.",
        )

    existing_payment = (
        Payment.objects
        .filter(
            order=order,
            status=Payment.Status.INITIATED,
        )
        .order_by("created_at")
        .first()
    )

    if existing_payment:
        return PaymentInitiationResult(
            payment=existing_payment,
            created=False,
        )

    if order.total_amount == Decimal("0.00"):
        try:
            with transaction.atomic():
                payment = _create_free_payment(order)
        except IntegrityError:
            payment = Payment.objects.get(
                order=order,
                provider="free",
            )
            return PaymentInitiationResult(
                payment=payment,
                created=False,
            )

        order.status = Order.Status.PAID
        order.paid_at = now
        order.save(
            update_fields=["status", "paid_at", "updated_at"]
        )
        issue_tickets_for_order(order)
        return PaymentInitiationResult(
            payment=payment,
            created=True,
        )

    try:
        with transaction.atomic():
            payment = _create_provider_payment(order)
    except IntegrityError:
        payment = Payment.objects.filter(
            order=order,
            status=Payment.Status.INITIATED,
        ).first()

        if payment is None:
            raise

        return PaymentInitiationResult(
            payment=payment,
            created=False,
        )

    return PaymentInitiationResult(
        payment=payment,
        created=True,
    )


def _mark_payment_succeeded(payment):
    payment.status = Payment.Status.SUCCEEDED
    payment.save(update_fields=["status", "updated_at"])


def _process_success(*, payment, order, now):
    if payment.status != Payment.Status.INITIATED:
        return PaymentProcessingResult(
            payment=payment,
            outcome="ignored",
        )

    if (
        order.status == Order.Status.PENDING
        and order.expires_at
        and order.expires_at <= now
    ):
        order.status = Order.Status.EXPIRED
        order.save(update_fields=["status", "updated_at"])
        _mark_payment_succeeded(payment)
        return PaymentProcessingResult(
            payment=payment,
            outcome="conflict",
            conflict=(
                "Ödəniş təsdiqləndi, lakin sifarişin "
                "rezervasiya vaxtı bitib."
            ),
        )

    if order.status == Order.Status.PENDING:
        _mark_payment_succeeded(payment)
        order.status = Order.Status.PAID
        order.paid_at = now
        order.save(
            update_fields=["status", "paid_at", "updated_at"]
        )
        issue_tickets_for_order(order)
        return PaymentProcessingResult(
            payment=payment,
            outcome="processed",
        )

    _mark_payment_succeeded(payment)

    if order.status == Order.Status.PAID:
        return PaymentProcessingResult(
            payment=payment,
            outcome="ignored",
        )

    return PaymentProcessingResult(
        payment=payment,
        outcome="conflict",
        conflict=(
            "Ödəniş təsdiqləndi, lakin sifariş artıq aktiv deyil. "
            "Manual refund/reconciliation tələb olunur."
        ),
    )


def _process_failure(*, payment, order):
    if payment.status != Payment.Status.INITIATED:
        return PaymentProcessingResult(
            payment=payment,
            outcome="ignored",
        )

    payment.status = Payment.Status.FAILED
    payment.save(update_fields=["status", "updated_at"])

    if order.status == Order.Status.PENDING:
        order.status = Order.Status.FAILED
        order.save(update_fields=["status", "updated_at"])

    return PaymentProcessingResult(
        payment=payment,
        outcome="processed",
    )


@transaction.atomic
def process_payment_event(
    *,
    provider,
    event_id,
    event_type,
    provider_reference,
    amount,
    currency,
):
    existing_event = (
        PaymentWebhookEvent.objects
        .select_related("payment")
        .filter(provider=provider, event_id=event_id)
        .first()
    )

    if existing_event:
        existing_payment = existing_event.payment

        if existing_payment is None:
            raise PaymentNotFound

        if (
            existing_event.event_type != event_type
            or existing_payment.provider_reference
            != provider_reference
            or existing_payment.amount != amount
            or existing_payment.currency != currency
        ):
            raise PaymentPayloadMismatch

        return PaymentProcessingResult(
            payment=existing_payment,
            outcome="duplicate",
        )

    payment_locator = (
        Payment.objects
        .filter(
            provider=provider,
            provider_reference=provider_reference,
        )
        .values("id", "order_id")
        .first()
    )

    if payment_locator is None:
        raise PaymentNotFound

    order = (
        Order.objects
        .select_for_update()
        .get(pk=payment_locator["order_id"])
    )

    try:
        payment = (
            Payment.objects
            .select_for_update()
            .get(
                pk=payment_locator["id"],
                provider=provider,
                provider_reference=provider_reference,
            )
        )
    except Payment.DoesNotExist as exc:
        raise PaymentNotFound from exc

    if payment.amount != amount or payment.currency != currency:
        raise PaymentPayloadMismatch

    try:
        with transaction.atomic():
            webhook_event = PaymentWebhookEvent.objects.create(
                provider=provider,
                event_id=event_id,
                event_type=event_type,
                payment=payment,
            )
    except IntegrityError:
        duplicate_event = (
            PaymentWebhookEvent.objects
            .select_related("payment")
            .get(provider=provider, event_id=event_id)
        )
        duplicate_payment = duplicate_event.payment

        if (
            duplicate_payment is None
            or duplicate_event.event_type != event_type
            or duplicate_payment.provider_reference
            != provider_reference
            or duplicate_payment.amount != amount
            or duplicate_payment.currency != currency
        ):
            raise PaymentPayloadMismatch

        return PaymentProcessingResult(
            payment=duplicate_payment,
            outcome="duplicate",
        )

    now = timezone.now()

    if event_type == "payment.succeeded":
        result = _process_success(
            payment=payment,
            order=order,
            now=now,
        )
    else:
        result = _process_failure(
            payment=payment,
            order=order,
        )

    webhook_event.processed_at = now
    webhook_event.save(update_fields=["processed_at"])
    return result
