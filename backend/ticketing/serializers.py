from rest_framework import serializers

from .models import Order, OrderItem, Payment, TicketType


class OrganizerTicketTypeSerializer(serializers.ModelSerializer):
    event_slug = serializers.CharField(
        source="event.slug",
        read_only=True,
    )

    class Meta:
        model = TicketType
        fields = [
            "id",
            "event_slug",
            "name",
            "price",
            "capacity",
            "max_per_order",
            "sales_start_at",
            "sales_end_at",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "event_slug",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        instance = self.instance
        event = (
            instance.event
            if instance
            else self.context.get("event")
        )

        capacity = attrs.get(
            "capacity",
            getattr(instance, "capacity", None),
        )
        max_per_order = attrs.get(
            "max_per_order",
            getattr(instance, "max_per_order", None),
        )
        sales_start_at = attrs.get(
            "sales_start_at",
            getattr(instance, "sales_start_at", None),
        )
        sales_end_at = attrs.get(
            "sales_end_at",
            getattr(instance, "sales_end_at", None),
        )
        name = attrs.get(
            "name",
            getattr(instance, "name", None),
        )

        errors = {}

        if capacity is not None and capacity < 1:
            errors["capacity"] = "Tutum ən azı 1 olmalıdır."

        if max_per_order is not None and max_per_order < 1:
            errors["max_per_order"] = (
                "Bir sifariş üzrə limit ən azı 1 olmalıdır."
            )

        if (
            capacity is not None
            and max_per_order is not None
            and max_per_order > capacity
        ):
            errors["max_per_order"] = (
                "Bir sifariş üzrə limit ümumi tutumdan "
                "çox ola bilməz."
            )

        if (
            sales_start_at
            and sales_end_at
            and sales_end_at <= sales_start_at
        ):
            errors["sales_end_at"] = (
                "Satışın bitmə vaxtı başlama vaxtından "
                "sonra olmalıdır."
            )

        if (
            event
            and sales_end_at
            and sales_end_at > event.start_at
        ):
            errors["sales_end_at"] = (
                "Bilet satışı tədbir başladıqdan sonra "
                "davam edə bilməz."
            )

        if event and name:
            duplicate_query = TicketType.objects.filter(
                event=event,
                name__iexact=name,
            )

            if instance:
                duplicate_query = duplicate_query.exclude(
                    pk=instance.pk
                )

            if duplicate_query.exists():
                errors["name"] = (
                    "Bu tədbirdə eyni adlı bilet növü artıq var."
                )

        if errors:
            raise serializers.ValidationError(errors)

        return attrs


class OrderCreateItemSerializer(serializers.Serializer):
    ticket_type_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1)


class OrderCreateSerializer(serializers.Serializer):
    items = OrderCreateItemSerializer(
        many=True,
        allow_empty=False,
    )

    def validate_items(self, items):
        if len(items) > 20:
            raise serializers.ValidationError(
                "Bir sifarişdə maksimum 20 bilet növü seçilə bilər."
            )

        ticket_type_ids = [
            item["ticket_type_id"]
            for item in items
        ]

        if len(ticket_type_ids) != len(set(ticket_type_ids)):
            raise serializers.ValidationError(
                "Eyni bilet növü sifarişdə təkrar göndərilə bilməz."
            )

        return items


class OrderItemReadSerializer(serializers.ModelSerializer):
    ticket_type_id = serializers.IntegerField(
        source="ticket_type.id",
        read_only=True,
    )
    ticket_type_name = serializers.CharField(
        source="ticket_type.name",
        read_only=True,
    )
    event_slug = serializers.CharField(
        source="ticket_type.event.slug",
        read_only=True,
    )
    event_title = serializers.CharField(
        source="ticket_type.event.title",
        read_only=True,
    )

    class Meta:
        model = OrderItem
        fields = [
            "id",
            "ticket_type_id",
            "ticket_type_name",
            "event_slug",
            "event_title",
            "quantity",
            "unit_price",
        ]


class OrderReadSerializer(serializers.ModelSerializer):
    items = OrderItemReadSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = [
            "id",
            "status",
            "total_amount",
            "currency",
            "expires_at",
            "created_at",
            "updated_at",
            "items",
        ]


class PaymentReadSerializer(serializers.ModelSerializer):
    order_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Payment
        fields = [
            "id",
            "order_id",
            "status",
            "amount",
            "currency",
            "provider",
            "provider_reference",
            "checkout_url",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class SandboxPaymentCompleteSerializer(serializers.Serializer):
    result = serializers.ChoiceField(
        choices=["succeeded", "failed"],
    )


class SandboxPaymentWebhookSerializer(serializers.Serializer):
    event_id = serializers.CharField(max_length=255)
    event_type = serializers.ChoiceField(
        choices=["payment.succeeded", "payment.failed"],
    )
    provider_reference = serializers.CharField(max_length=255)
    amount = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=0,
    )
    currency = serializers.CharField(
        min_length=3,
        max_length=3,
    )
