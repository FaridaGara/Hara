import uuid

from django.urls import reverse

from ticketing.models import Payment


def create_sandbox_payment(order):
    payment = Payment(
        order=order,
        status=Payment.Status.INITIATED,
        amount=order.total_amount,
        currency=order.currency,
        provider="sandbox",
        provider_reference=f"sandbox_{uuid.uuid4().hex}",
    )
    payment.checkout_url = reverse(
        "sandbox-payment-complete",
        kwargs={"payment_id": payment.id},
    )
    payment.save(force_insert=True)
    return payment
