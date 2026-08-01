import uuid

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class TicketType(models.Model):
    event = models.ForeignKey(
        "events.Event",
        on_delete=models.CASCADE,
        related_name="ticket_types",
    )
    name = models.CharField(max_length=120)
    price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    capacity = models.PositiveIntegerField()
    max_per_order = models.PositiveSmallIntegerField(default=10)
    sales_start_at = models.DateTimeField(null=True, blank=True)
    sales_end_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["price", "id"]

    def __str__(self):
        return f"{self.event.title} — {self.name}"


class Order(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"
        FAILED = "failed", "Failed"
        EXPIRED = "expired", "Expired"
        REFUNDED = "refunded", "Refunded"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    buyer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="orders",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    total_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
    )
    currency = models.CharField(max_length=3, default="AZN")
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.id} — {self.status}"


class OrderItem(models.Model):
    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name="items",
    )
    ticket_type = models.ForeignKey(
        TicketType,
        on_delete=models.PROTECT,
        related_name="order_items",
    )
    quantity = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1)],
    )
    unit_price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )

    def __str__(self):
        return f"{self.ticket_type.name} × {self.quantity}"


class OrderIdempotencyKey(models.Model):
    buyer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="order_idempotency_keys",
    )
    key = models.CharField(max_length=255)
    request_fingerprint = models.CharField(max_length=64)
    order = models.OneToOneField(
        Order,
        on_delete=models.PROTECT,
        related_name="idempotency_key",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["buyer", "key"],
                name="ticketing_unique_order_idempotency_key",
            ),
        ]


class Payment(models.Model):
    class Status(models.TextChoices):
        INITIATED = "initiated", "Initiated"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"
        REFUNDED = "refunded", "Refunded"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    order = models.ForeignKey(
        Order,
        on_delete=models.PROTECT,
        related_name="payments",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.INITIATED,
        db_index=True,
    )
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    currency = models.CharField(max_length=3, default="AZN")
    provider = models.CharField(max_length=50, blank=True)
    provider_reference = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        unique=True,
    )
    checkout_url = models.CharField(
        max_length=500,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["order"],
                condition=models.Q(status="initiated"),
                name="ticketing_one_initiated_payment_per_order",
            ),
            models.UniqueConstraint(
                fields=["order"],
                condition=models.Q(provider="free"),
                name="ticketing_one_free_payment_per_order",
            ),
        ]

    def __str__(self):
        return f"{self.order_id} — {self.status}"


class PaymentWebhookEvent(models.Model):
    provider = models.CharField(max_length=50)
    event_id = models.CharField(max_length=255)
    event_type = models.CharField(max_length=100)
    payment = models.ForeignKey(
        Payment,
        on_delete=models.SET_NULL,
        related_name="webhook_events",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "event_id"],
                name="ticketing_unique_webhook_provider_event",
            ),
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.provider} — {self.event_id}"


class Ticket(models.Model):
    class Status(models.TextChoices):
        VALID = "valid", "Valid"
        USED = "used", "Used"
        CANCELLED = "cancelled", "Cancelled"
        REFUNDED = "refunded", "Refunded"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    order_item = models.ForeignKey(
        OrderItem,
        on_delete=models.PROTECT,
        related_name="tickets",
    )
    event = models.ForeignKey(
        "events.Event",
        on_delete=models.PROTECT,
        related_name="tickets",
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="tickets",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.VALID,
        db_index=True,
    )
    qr_code = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        editable=False,
    )
    issued_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)
    checked_in_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="checked_in_tickets",
        null=True,
        blank=True,
    )

    def __str__(self):
        return f"{self.event.title} — {self.id}"
