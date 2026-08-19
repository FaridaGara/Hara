from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from events.models import Event, VenueSection

from .inventory import get_inventory_snapshot
from .models import Order, OrderItem, Payment, Ticket, TicketType
from .sales import TicketSalesStatus, get_ticket_sales_status


def safe_user_display_name(user) -> str:
    if user is None:
        return "İstifadəçi"

    display_name = (user.display_name or "").strip()
    return display_name or "İstifadəçi"


class PublicTicketTypeSerializer(serializers.ModelSerializer):
    venue_section_id = serializers.UUIDField(read_only=True)
    currency = serializers.SerializerMethodField()
    available_quantity = serializers.SerializerMethodField()
    min_quantity = serializers.SerializerMethodField()
    max_quantity = serializers.SerializerMethodField()
    sales_status = serializers.SerializerMethodField()
    is_available = serializers.SerializerMethodField()
    venue_section = serializers.SerializerMethodField()

    class Meta:
        model = TicketType
        fields = [
            "id",
            "name",
            "venue_section_id",
            "venue_section",
            "price",
            "currency",
            "available_quantity",
            "sales_start_at",
            "sales_end_at",
            "min_quantity",
            "max_quantity",
            "sales_status",
            "is_available",
        ]
        read_only_fields = fields

    @staticmethod
    @extend_schema_field(
        serializers.ChoiceField(choices=["AZN"])
    )
    def get_currency(ticket_type) -> str:
        return "AZN"

    @staticmethod
    def get_available_quantity(ticket_type) -> int:
        annotated_value = getattr(
            ticket_type,
            "available_quantity",
            None,
        )

        if annotated_value is not None:
            return annotated_value

        return get_inventory_snapshot(
            ticket_type
        ).available_quantity

    @staticmethod
    def get_min_quantity(ticket_type) -> int:
        return 1

    def get_max_quantity(self, ticket_type) -> int:
        return min(
            ticket_type.max_per_order,
            self.get_available_quantity(ticket_type),
        )

    @extend_schema_field(
        serializers.ChoiceField(
            choices=TicketSalesStatus.choices,
        )
    )
    def get_sales_status(self, ticket_type) -> str:
        return get_ticket_sales_status(
            ticket_type,
            available_quantity=self.get_available_quantity(
                ticket_type
            ),
            now=self.context.get("ticket_contract_now"),
        )

    def get_is_available(self, ticket_type) -> bool:
        return (
            self.get_sales_status(ticket_type)
            == TicketSalesStatus.AVAILABLE
        )

    @staticmethod
    def get_venue_section(ticket_type) -> dict | None:
        section = ticket_type.venue_section
        if section is None:
            return None
        return {
            "id": str(section.id),
            "code": section.code,
            "name": section.name,
            "color": section.color,
            "seating_type": section.seating_type,
        }


class OrganizerTicketTypeSerializer(serializers.ModelSerializer):
    event_slug = serializers.CharField(
        source="event.slug",
        read_only=True,
    )
    available_quantity = serializers.SerializerMethodField()
    is_available = serializers.SerializerMethodField()
    venue_section_id = serializers.PrimaryKeyRelatedField(
        source="venue_section",
        queryset=VenueSection.objects.select_related("venue_plan"),
        required=False,
        allow_null=True,
    )
    venue_section = serializers.SerializerMethodField()

    class Meta:
        model = TicketType
        fields = [
            "id",
            "event_slug",
            "name",
            "venue_section_id",
            "venue_section",
            "price",
            "capacity",
            "available_quantity",
            "max_per_order",
            "sales_start_at",
            "sales_end_at",
            "is_active",
            "is_available",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "event_slug",
            "venue_section",
            "available_quantity",
            "is_available",
            "created_at",
            "updated_at",
        ]

    @staticmethod
    def get_available_quantity(ticket_type) -> int:
        annotated_value = getattr(
            ticket_type,
            "available_quantity",
            None,
        )

        if annotated_value is not None:
            return annotated_value

        snapshot = get_inventory_snapshot(ticket_type)
        return snapshot.available_quantity

    def get_is_available(self, ticket_type) -> bool:
        now = timezone.now()
        return (
            self.get_available_quantity(ticket_type) > 0
            and ticket_type.is_active
            and ticket_type.event.status == Event.Status.PUBLISHED
            and ticket_type.event.start_at > now
            and (
                ticket_type.sales_start_at is None
                or ticket_type.sales_start_at <= now
            )
            and (
                ticket_type.sales_end_at is None
                or ticket_type.sales_end_at > now
            )
        )

    @staticmethod
    def get_venue_section(ticket_type) -> dict | None:
        section = ticket_type.venue_section
        if section is None:
            return None
        return {
            "id": str(section.id),
            "code": section.code,
            "name": section.name,
            "color": section.color,
            "seating_type": section.seating_type,
            "capacity": section.capacity,
        }

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
        venue_section = attrs.get(
            "venue_section",
            getattr(instance, "venue_section", None),
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

        if venue_section and event:
            if event.venue_plan_id != venue_section.venue_plan_id:
                errors["venue_section_id"] = (
                    "Seçilən zona tədbirin məkan planına aid deyil."
                )
            elif capacity is not None and capacity > venue_section.capacity:
                errors["capacity"] = (
                    "Bilet tutumu zona tutumundan çox ola bilməz."
                )

            duplicate_section = TicketType.objects.filter(
                event=event,
                venue_section=venue_section,
            )
            if instance:
                duplicate_section = duplicate_section.exclude(pk=instance.pk)
            if duplicate_section.exists():
                errors["venue_section_id"] = (
                    "Bu zona üçün tədbirdə artıq bilet qiyməti təyin edilib."
                )

        if errors:
            raise serializers.ValidationError(errors)

        return attrs


class StrictPositiveIntegerField(serializers.IntegerField):
    default_error_messages = {
        "invalid": "Düzgün müsbət tam ədəd daxil edin.",
    }

    def to_internal_value(self, data):
        if isinstance(data, bool) or not isinstance(data, int):
            self.fail("invalid")

        return super().to_internal_value(data)


class OrderCreateItemSerializer(serializers.Serializer):
    ticket_type_id = serializers.IntegerField()
    quantity = StrictPositiveIntegerField(min_value=1)


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


class TicketFilterSerializer(serializers.Serializer):
    event_status = serializers.ChoiceField(
        choices=["upcoming", "past"],
        required=False,
    )
    is_checked_in = serializers.ChoiceField(
        choices=["true", "false"],
        required=False,
    )


class TicketReadSerializer(serializers.ModelSerializer):
    currency = serializers.CharField(
        source="order_item.order.currency",
        read_only=True,
    )
    event_slug = serializers.CharField(
        source="event.slug",
        read_only=True,
    )
    event_title = serializers.CharField(
        source="event.title",
        read_only=True,
    )
    event_start_at = serializers.DateTimeField(
        source="event.start_at",
        read_only=True,
    )
    event_end_at = serializers.DateTimeField(
        source="event.end_at",
        read_only=True,
    )
    event_location_name = serializers.CharField(
        source="event.venue.name",
        read_only=True,
    )
    event_cover_image_url = serializers.URLField(
        source="event.cover_image_url",
        read_only=True,
    )
    ticket_type_name = serializers.CharField(
        source="order_item.ticket_type.name",
        read_only=True,
    )
    unit_price = serializers.DecimalField(
        source="order_item.unit_price",
        max_digits=10,
        decimal_places=2,
        read_only=True,
    )
    owner_display_name = serializers.SerializerMethodField()
    is_checked_in = serializers.SerializerMethodField()
    checked_in_at = serializers.DateTimeField(
        source="used_at",
        read_only=True,
        allow_null=True,
    )
    created_at = serializers.DateTimeField(
        source="issued_at",
        read_only=True,
    )

    class Meta:
        model = Ticket
        fields = [
            "id",
            "qr_code",
            "status",
            "event_slug",
            "event_title",
            "event_start_at",
            "event_end_at",
            "event_location_name",
            "event_cover_image_url",
            "ticket_type_name",
            "unit_price",
            "currency",
            "owner_display_name",
            "is_checked_in",
            "checked_in_at",
            "created_at",
        ]
        read_only_fields = fields

    @staticmethod
    def get_owner_display_name(ticket) -> str:
        return safe_user_display_name(ticket.owner)

    @staticmethod
    def get_is_checked_in(ticket) -> bool:
        return ticket.used_at is not None


class TicketCheckInInputSerializer(serializers.Serializer):
    qr_code = serializers.UUIDField()


class OrganizerTicketCheckInSerializer(serializers.ModelSerializer):
    ticket_id = serializers.UUIDField(
        source="id",
        read_only=True,
    )
    event_slug = serializers.CharField(
        source="event.slug",
        read_only=True,
    )
    event_title = serializers.CharField(
        source="event.title",
        read_only=True,
    )
    ticket_type_name = serializers.CharField(
        source="order_item.ticket_type.name",
        read_only=True,
    )
    attendee_display_name = serializers.SerializerMethodField()
    checked_in_at = serializers.DateTimeField(
        source="used_at",
        read_only=True,
    )

    class Meta:
        model = Ticket
        fields = [
            "ticket_id",
            "event_slug",
            "event_title",
            "ticket_type_name",
            "attendee_display_name",
            "checked_in_at",
        ]
        read_only_fields = fields

    @staticmethod
    def get_attendee_display_name(ticket) -> str:
        return safe_user_display_name(ticket.owner)


class OrganizerTicketCheckInListSerializer(
    OrganizerTicketCheckInSerializer
):
    checked_in_by_display_name = serializers.SerializerMethodField()

    class Meta(OrganizerTicketCheckInSerializer.Meta):
        fields = [
            "ticket_id",
            "ticket_type_name",
            "attendee_display_name",
            "checked_in_at",
            "checked_in_by_display_name",
        ]

    @staticmethod
    def get_checked_in_by_display_name(ticket) -> str:
        return safe_user_display_name(ticket.checked_in_by)


class DetailErrorSerializer(serializers.Serializer):
    detail = serializers.CharField()


class OrderConflictSerializer(DetailErrorSerializer):
    code = serializers.ChoiceField(
        choices=[
            "INSUFFICIENT_CAPACITY",
            "IDEMPOTENCY_KEY_REUSED",
            "IDEMPOTENCY_REQUEST_IN_PROGRESS",
        ],
        required=False,
    )
    ticket_type_id = serializers.IntegerField(required=False)
    requested_quantity = serializers.IntegerField(required=False)
    available_quantity = serializers.IntegerField(required=False)


class OrganizerTicketCheckInResponseSerializer(
    OrganizerTicketCheckInSerializer
):
    result = serializers.ChoiceField(
        choices=["checked_in"],
        read_only=True,
    )

    class Meta(OrganizerTicketCheckInSerializer.Meta):
        fields = [
            "result",
            *OrganizerTicketCheckInSerializer.Meta.fields,
        ]


class AlreadyCheckedInSerializer(DetailErrorSerializer):
    result = serializers.ChoiceField(
        choices=["already_checked_in"],
    )
    checked_in_at = serializers.DateTimeField()


class WebhookOutcomeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=["processed", "duplicate", "ignored"],
    )
