from django.contrib import admin

from .models import Payment, PaymentWebhookEvent


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "order",
        "status",
        "amount",
        "currency",
        "provider",
        "created_at",
    ]
    list_filter = ["status", "provider", "currency"]
    search_fields = [
        "id",
        "order__id",
        "provider_reference",
    ]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(PaymentWebhookEvent)
class PaymentWebhookEventAdmin(admin.ModelAdmin):
    list_display = [
        "event_id",
        "provider",
        "event_type",
        "payment",
        "created_at",
        "processed_at",
    ]
    list_filter = ["provider", "event_type"]
    search_fields = [
        "event_id",
        "payment__id",
        "payment__provider_reference",
    ]
    readonly_fields = [
        "created_at",
        "processed_at",
    ]
