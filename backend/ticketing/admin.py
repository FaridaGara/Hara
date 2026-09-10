from django.contrib import admin

from .models import Payment, PaymentWebhookEvent, RefundRequest


@admin.register(RefundRequest)
class RefundRequestAdmin(admin.ModelAdmin):
    list_display = ['id', 'event', 'order', 'amount', 'currency', 'created_at']
    search_fields = ['event__title', 'order__id', 'order__buyer__email']
    list_filter = ['currency']
    readonly_fields = ['id', 'event', 'order', 'amount', 'currency', 'created_at']

    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False


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
