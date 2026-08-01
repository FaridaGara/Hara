import hashlib
import hmac

from django.conf import settings
from django.db import transaction
from django.db.models import Prefetch
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import (
    OpenApiExample,
    OpenApiParameter,
    OpenApiResponse,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework import status
from rest_framework.generics import (
    ListCreateAPIView,
    RetrieveUpdateDestroyAPIView,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from events.models import Event
from events.permissions import IsOrganizer

from .checkins.services import (
    TicketCheckInConflict,
    TicketCheckInNotFound,
    check_in_ticket,
    ticket_check_in_queryset,
)
from .inventory import annotate_inventory, get_inventory_snapshot
from .models import Order, OrderItem, Payment, Ticket, TicketType
from .orders.expiration import expire_pending_orders
from .orders.reservations import (
    OrderReservationError,
    reserve_order,
)
from .payments.services import (
    PaymentNotFound,
    PaymentOrderNotFound,
    PaymentPayloadMismatch,
    PaymentProviderUnavailable,
    initiate_payment,
    process_payment_event,
)
from .serializers import (
    AlreadyCheckedInSerializer,
    DetailErrorSerializer,
    OrderCreateSerializer,
    OrderConflictSerializer,
    OrderReadSerializer,
    OrganizerTicketCheckInListSerializer,
    OrganizerTicketCheckInResponseSerializer,
    OrganizerTicketCheckInSerializer,
    OrganizerTicketTypeSerializer,
    PaymentReadSerializer,
    SandboxPaymentCompleteSerializer,
    SandboxPaymentWebhookSerializer,
    TicketCheckInInputSerializer,
    TicketFilterSerializer,
    TicketReadSerializer,
    WebhookOutcomeSerializer,
)

ORDER_CREATE_EXAMPLES = [
    OpenApiExample(
        "Order creation",
        value={
            "items": [
                {"ticket_type_id": 12, "quantity": 2},
            ]
        },
        request_only=True,
    ),
]
ORDER_CONFLICT_EXAMPLES = [
    OpenApiExample(
        "Capacity conflict",
        value={
            "detail": "“Standard” üçün yalnız 1 bilet qalıb.",
            "code": "INSUFFICIENT_CAPACITY",
            "ticket_type_id": 12,
            "requested_quantity": 2,
            "available_quantity": 1,
        },
        response_only=True,
        status_codes=["409"],
    ),
    OpenApiExample(
        "Idempotency conflict",
        value={
            "detail": (
                "Bu Idempotency-Key fərqli sorğu üçün istifadə olunub."
            ),
            "code": "IDEMPOTENCY_KEY_REUSED",
        },
        response_only=True,
        status_codes=["409"],
    ),
]
TICKET_RESPONSE_EXAMPLES = [
    OpenApiExample(
        "Ticket",
        value={
            "id": "10000000-0000-4000-8000-000000000001",
            "qr_code": "20000000-0000-4000-8000-000000000001",
            "event_slug": "sample-event",
            "event_title": "Sample Event",
            "event_start_at": "2026-08-10T18:00:00Z",
            "event_end_at": "2026-08-10T20:00:00Z",
            "event_location_name": "Sample Venue",
            "ticket_type_name": "Standard",
            "unit_price": "20.00",
            "currency": "AZN",
            "status": "valid",
            "owner_display_name": "Attendee",
            "is_checked_in": False,
            "checked_in_at": None,
            "created_at": "2026-08-01T12:00:00Z",
        },
        response_only=True,
    ),
]
CHECK_IN_EXAMPLES = [
    OpenApiExample(
        "Check-in request",
        value={
            "qr_code": "20000000-0000-4000-8000-000000000001",
        },
        request_only=True,
    ),
    OpenApiExample(
        "Successful check-in",
        value={
            "result": "checked_in",
            "ticket_id": "10000000-0000-4000-8000-000000000001",
            "event_slug": "sample-event",
            "event_title": "Sample Event",
            "ticket_type_name": "Standard",
            "attendee_display_name": "Attendee",
            "checked_in_at": "2026-08-10T17:45:00Z",
        },
        response_only=True,
        status_codes=["200"],
    ),
    OpenApiExample(
        "Duplicate check-in",
        value={
            "detail": "Bu bilet artıq check-in edilib.",
            "result": "already_checked_in",
            "checked_in_at": "2026-08-10T17:45:00Z",
        },
        response_only=True,
        status_codes=["409"],
    ),
]


def order_read_queryset():
    return Order.objects.prefetch_related(
        Prefetch(
            "items",
            queryset=OrderItem.objects.select_related(
                "ticket_type__event"
            ).order_by("id"),
        )
    )


def ticket_read_queryset():
    return Ticket.objects.select_related(
        "event",
        "event__venue",
        "owner",
        "order_item",
        "order_item__order",
        "order_item__ticket_type",
    )


@extend_schema_view(
    get=extend_schema(
        operation_id="organizer_ticket_type_list",
        description=(
            "Ticket types for an organizer-owned event, including current "
            "availability."
        ),
        responses={200: OrganizerTicketTypeSerializer(many=True)},
    ),
    post=extend_schema(
        operation_id="organizer_ticket_type_create",
        description="Create a ticket type for an organizer-owned event.",
        responses={201: OrganizerTicketTypeSerializer},
    ),
)
class OrganizerTicketTypeListCreateAPIView(
    ListCreateAPIView
):
    serializer_class = OrganizerTicketTypeSerializer
    permission_classes = [IsOrganizer]

    def get_event(self):
        queryset = Event.objects.all()

        if not self.request.user.is_staff:
            queryset = queryset.filter(
                organizer=self.request.user
            )

        return get_object_or_404(
            queryset,
            slug=self.kwargs["event_slug"],
        )

    def get_queryset(self):
        queryset = (
            self.get_event()
            .ticket_types
            .select_related("event")
            .order_by("price", "id")
        )
        return annotate_inventory(queryset)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["event"] = self.get_event()
        return context

    def perform_create(self, serializer):
        serializer.save(event=self.get_event())


@extend_schema_view(
    get=extend_schema(
        operation_id="organizer_ticket_type_detail",
        description=(
            "Organizer-owned ticket type detail. Cross-owner access "
            "returns 404."
        ),
    ),
    put=extend_schema(
        operation_id="organizer_ticket_type_update",
        responses={
            200: OrganizerTicketTypeSerializer,
            409: OpenApiResponse(
                description=(
                    "Lifecycle lock or capacity below sold and reserved."
                )
            ),
        },
    ),
    patch=extend_schema(
        operation_id="organizer_ticket_type_partial_update",
        responses={
            200: OrganizerTicketTypeSerializer,
            409: OpenApiResponse(
                description=(
                    "Lifecycle lock or capacity below sold and reserved."
                )
            ),
        },
    ),
    delete=extend_schema(
        operation_id="organizer_ticket_type_delete",
        responses={
            204: None,
            409: OpenApiResponse(
                description="Sold ticket type is lifecycle-locked."
            ),
        },
    ),
)
class OrganizerTicketTypeDetailAPIView(
    RetrieveUpdateDestroyAPIView
):
    serializer_class = OrganizerTicketTypeSerializer
    permission_classes = [IsOrganizer]

    def get_queryset(self):
        queryset = TicketType.objects.select_related("event").filter(
            event__slug=self.kwargs["event_slug"],
        )

        if self.request.user.is_staff:
            return queryset

        return queryset.filter(
            event__organizer=self.request.user
        )

    @staticmethod
    def has_ticket_sales(ticket_type):
        return ticket_type.order_items.filter(
            tickets__isnull=False,
        ).exists()

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        ticket_type = get_object_or_404(
            self.get_queryset().select_for_update(),
            pk=kwargs["pk"],
        )

        if self.has_ticket_sales(ticket_type):
            submitted_fields = set(request.data.keys())
            allowed_fields = {"is_active"}

            if not submitted_fields.issubset(allowed_fields):
                return Response(
                    {
                        "detail": (
                            "Bu bilet növü üzrə satış olduğu üçün "
                            "yalnız aktivlik statusu dəyişdirilə bilər."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

        partial = kwargs.pop("partial", False)
        serializer = self.get_serializer(
            ticket_type,
            data=request.data,
            partial=partial,
        )
        serializer.is_valid(raise_exception=True)
        proposed_capacity = serializer.validated_data.get("capacity")

        if proposed_capacity is not None:
            inventory = get_inventory_snapshot(
                ticket_type,
                now=timezone.now(),
            )
            committed_quantity = (
                inventory.reserved_quantity
                + inventory.sold_quantity
            )

            if proposed_capacity < committed_quantity:
                return Response(
                    {
                        "detail": (
                            "Capacity aktiv rezerv və satılmış "
                            "bilet sayından aşağı ola bilməz."
                        ),
                        "code": "CAPACITY_BELOW_COMMITTED",
                        "minimum_capacity": committed_quantity,
                    },
                    status=status.HTTP_409_CONFLICT,
                )

        self.perform_update(serializer)
        return Response(
            serializer.data,
            status=status.HTTP_200_OK,
        )

    def destroy(self, request, *args, **kwargs):
        ticket_type = self.get_object()

        if self.has_ticket_sales(ticket_type):
            return Response(
                {
                    "detail": (
                        "Bu bilet növü üzrə satış olduğu üçün "
                        "onu silmək mümkün deyil. Satışı dayandırmaq "
                        "üçün is_active dəyərini false et."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        return super().destroy(request, *args, **kwargs)


class OrderCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="order_list",
        description=(
            "Orders owned by the authenticated user. Due pending orders "
            "are persisted as expired before serialization."
        ),
        responses={
            200: OrderReadSerializer(many=True),
            401: DetailErrorSerializer,
        },
    )
    def get(self, request):
        queryset = order_read_queryset().filter(
            buyer=request.user
        )
        expire_pending_orders(
            now=timezone.now(),
            buyer_id=request.user.pk,
        )

        return Response(
            OrderReadSerializer(queryset, many=True).data,
            status=status.HTTP_200_OK,
        )

    @transaction.atomic
    @extend_schema(
        operation_id="order_create",
        description=(
            "Atomically reserve ticket inventory and create an order. "
            "Idempotency-Key is optional for backward compatibility."
        ),
        request=OrderCreateSerializer,
        parameters=[
            OpenApiParameter(
                "Idempotency-Key",
                OpenApiTypes.STR,
                location=OpenApiParameter.HEADER,
                required=False,
                description=(
                    "1–255 character mutation key, scoped to the user."
                ),
            ),
        ],
        responses={
            200: OrderReadSerializer,
            201: OrderReadSerializer,
            400: OpenApiResponse(description="Validation error."),
            401: DetailErrorSerializer,
            409: OrderConflictSerializer,
        },
        examples=[
            *ORDER_CREATE_EXAMPLES,
            *ORDER_CONFLICT_EXAMPLES,
        ],
    )
    def post(self, request):
        input_serializer = OrderCreateSerializer(
            data=request.data
        )
        input_serializer.is_valid(raise_exception=True)

        idempotency_key = request.headers.get("Idempotency-Key")

        if idempotency_key is not None:
            idempotency_key = idempotency_key.strip()

            if not idempotency_key or len(idempotency_key) > 255:
                return Response(
                    {
                        "detail": (
                            "Idempotency-Key 1–255 simvol "
                            "uzunluğunda olmalıdır."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            reservation = reserve_order(
                buyer=request.user,
                items=input_serializer.validated_data["items"],
                idempotency_key=idempotency_key,
            )
        except OrderReservationError as exc:
            return Response(
                exc.payload,
                status=exc.status_code,
            )

        order = order_read_queryset().get(
            pk=reservation.order.pk
        )
        output_serializer = OrderReadSerializer(order)
        response_status = (
            status.HTTP_201_CREATED
            if reservation.created
            else status.HTTP_200_OK
        )

        return Response(
            output_serializer.data,
            status=response_status,
        )


class OrderDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="order_detail",
        description=(
            "Owned order detail. Another user's order returns 404."
        ),
        responses={
            200: OrderReadSerializer,
            401: DetailErrorSerializer,
            404: DetailErrorSerializer,
        },
    )
    def get(self, request, order_id):
        expire_pending_orders(
            now=timezone.now(),
            order_ids=[order_id],
            buyer_id=request.user.pk,
        )
        order = get_object_or_404(
            order_read_queryset().filter(buyer=request.user),
            pk=order_id,
        )

        return Response(
            OrderReadSerializer(order).data,
            status=status.HTTP_200_OK,
        )


class OrderCancelAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    @extend_schema(
        operation_id="order_cancel",
        description=(
            "Cancel an owned, unexpired pending order. Terminal or "
            "elapsed orders return 409."
        ),
        request=None,
        responses={
            200: OrderReadSerializer,
            401: DetailErrorSerializer,
            404: DetailErrorSerializer,
            409: DetailErrorSerializer,
        },
    )
    def post(self, request, order_id):
        order = get_object_or_404(
            order_read_queryset()
            .select_for_update()
            .filter(buyer=request.user),
            pk=order_id,
        )
        now = timezone.now()

        if order.status != Order.Status.PENDING:
            return Response(
                {"detail": "Bu sifarişi ləğv etmək mümkün deyil."},
                status=status.HTTP_409_CONFLICT,
            )

        if order.expires_at and order.expires_at <= now:
            order.status = Order.Status.EXPIRED
            order.save(update_fields=["status", "updated_at"])

            return Response(
                {
                    "detail": (
                        "Rezervasiya vaxtı bitdiyi üçün sifariş "
                        "ləğv edilə bilməz."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        order.status = Order.Status.CANCELLED
        order.save(update_fields=["status", "updated_at"])

        return Response(
            OrderReadSerializer(order).data,
            status=status.HTTP_200_OK,
        )


class TicketListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="ticket_list",
        description="Tickets owned by the authenticated user, newest first.",
        parameters=[
            OpenApiParameter(
                "event_status",
                OpenApiTypes.STR,
                enum=["upcoming", "past"],
                description=(
                    "upcoming means event end_at is now or later; "
                    "past means it is earlier."
                ),
            ),
            OpenApiParameter(
                "is_checked_in",
                OpenApiTypes.STR,
                enum=["true", "false"],
                description="Filter by persisted check-in time.",
            ),
        ],
        responses={
            200: TicketReadSerializer(many=True),
            400: OpenApiResponse(description="Invalid filter value."),
            401: DetailErrorSerializer,
        },
        examples=TICKET_RESPONSE_EXAMPLES,
    )
    def get(self, request):
        filter_serializer = TicketFilterSerializer(
            data=request.query_params
        )
        filter_serializer.is_valid(raise_exception=True)
        filters = filter_serializer.validated_data
        queryset = ticket_read_queryset().filter(
            owner=request.user
        )

        event_status = filters.get("event_status")

        if event_status == "upcoming":
            queryset = queryset.filter(
                event__end_at__gte=timezone.now()
            )
        elif event_status == "past":
            queryset = queryset.filter(
                event__end_at__lt=timezone.now()
            )

        is_checked_in = filters.get("is_checked_in")

        if is_checked_in == "true":
            queryset = queryset.filter(used_at__isnull=False)
        elif is_checked_in == "false":
            queryset = queryset.filter(used_at__isnull=True)

        queryset = queryset.order_by("-issued_at")

        return Response(
            TicketReadSerializer(queryset, many=True).data,
            status=status.HTTP_200_OK,
        )


class TicketDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="ticket_detail",
        description=(
            "Owned ticket detail. Another user's ticket returns 404."
        ),
        responses={
            200: TicketReadSerializer,
            401: DetailErrorSerializer,
            404: DetailErrorSerializer,
        },
        examples=TICKET_RESPONSE_EXAMPLES,
    )
    def get(self, request, ticket_id):
        ticket = get_object_or_404(
            ticket_read_queryset().filter(owner=request.user),
            pk=ticket_id,
        )

        return Response(
            TicketReadSerializer(ticket).data,
            status=status.HTTP_200_OK,
        )


class OrganizerTicketCheckInAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get_event(self):
        return get_object_or_404(
            Event.objects.filter(organizer=self.request.user),
            slug=self.kwargs["event_slug"],
        )

    @extend_schema(
        operation_id="organizer_check_in_list",
        description=(
            "Checked-in tickets for an organizer-owned event, newest "
            "check-in first. Cross-owner event access returns 404."
        ),
        responses={
            200: OrganizerTicketCheckInListSerializer(many=True),
            401: DetailErrorSerializer,
            404: DetailErrorSerializer,
        },
    )
    def get(self, request, event_slug):
        event = self.get_event()
        tickets = (
            ticket_check_in_queryset()
            .filter(
                event=event,
                used_at__isnull=False,
            )
            .order_by("-used_at")
        )

        return Response(
            OrganizerTicketCheckInListSerializer(
                tickets,
                many=True,
            ).data,
            status=status.HTTP_200_OK,
        )

    @extend_schema(
        operation_id="organizer_ticket_check_in",
        description=(
            "Check in one paid, valid ticket using its UUID QR payload. "
            "The row is locked so parallel scans produce one success."
        ),
        request=TicketCheckInInputSerializer,
        responses={
            200: OrganizerTicketCheckInResponseSerializer,
            400: OpenApiResponse(description="Missing or malformed UUID."),
            401: DetailErrorSerializer,
            404: DetailErrorSerializer,
            409: AlreadyCheckedInSerializer,
        },
        examples=CHECK_IN_EXAMPLES,
    )
    def post(self, request, event_slug):
        input_serializer = TicketCheckInInputSerializer(
            data=request.data
        )
        input_serializer.is_valid(raise_exception=True)
        event = self.get_event()

        try:
            result = check_in_ticket(
                event=event,
                qr_code=input_serializer.validated_data["qr_code"],
                organizer=request.user,
            )
        except TicketCheckInNotFound as exc:
            raise Http404 from exc
        except TicketCheckInConflict as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_409_CONFLICT,
            )

        if result.already_checked_in:
            return Response(
                {
                    "detail": "Bu bilet artıq check-in edilib.",
                    "result": "already_checked_in",
                    "checked_in_at": result.ticket.used_at,
                },
                status=status.HTTP_409_CONFLICT,
            )

        response_data = {
            "result": "checked_in",
            **OrganizerTicketCheckInSerializer(
                result.ticket
            ).data,
        }
        return Response(
            response_data,
            status=status.HTTP_200_OK,
        )


class PaymentInitiateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="payment_initiate",
        description=(
            "Initiate payment for an owned pending order. Amount and "
            "currency always come from the server-side order. Replays "
            "return the existing payment."
        ),
        request=None,
        responses={
            200: PaymentReadSerializer,
            201: PaymentReadSerializer,
            401: DetailErrorSerializer,
            404: DetailErrorSerializer,
            409: DetailErrorSerializer,
            503: DetailErrorSerializer,
        },
        examples=[
            OpenApiExample(
                "Payment initiation",
                value={
                    "id": "30000000-0000-4000-8000-000000000001",
                    "order_id": (
                        "40000000-0000-4000-8000-000000000001"
                    ),
                    "status": "initiated",
                    "amount": "40.00",
                    "currency": "AZN",
                    "provider": "sandbox",
                    "provider_reference": "sandbox_example_reference",
                    "checkout_url": (
                        "/api/payments/sandbox/"
                        "30000000-0000-4000-8000-000000000001/"
                        "complete/"
                    ),
                    "created_at": "2026-08-01T12:00:00Z",
                    "updated_at": "2026-08-01T12:00:00Z",
                },
                response_only=True,
            )
        ],
    )
    def post(self, request, order_id):
        try:
            result = initiate_payment(
                order_id=order_id,
                buyer=request.user,
            )
        except PaymentOrderNotFound as exc:
            raise Http404 from exc
        except PaymentProviderUnavailable as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if result.conflict:
            return Response(
                {"detail": result.conflict},
                status=status.HTTP_409_CONFLICT,
            )

        response_status = (
            status.HTTP_201_CREATED
            if result.created
            else status.HTTP_200_OK
        )
        return Response(
            PaymentReadSerializer(result.payment).data,
            status=response_status,
        )


class SandboxPaymentCompleteAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="sandbox_payment_complete",
        description=(
            "Development sandbox completion for an owned sandbox payment. "
            "This is not a Chewick integration."
        ),
        request=SandboxPaymentCompleteSerializer,
        responses={
            200: PaymentReadSerializer,
            400: OpenApiResponse(description="Invalid result or payload."),
            401: DetailErrorSerializer,
            404: DetailErrorSerializer,
            409: DetailErrorSerializer,
        },
    )
    def post(self, request, payment_id):
        if not settings.PAYMENT_SANDBOX_ENABLED:
            raise Http404

        input_serializer = SandboxPaymentCompleteSerializer(
            data=request.data
        )
        input_serializer.is_valid(raise_exception=True)
        payment = get_object_or_404(
            Payment.objects.select_related("order"),
            pk=payment_id,
            provider="sandbox",
            order__buyer=request.user,
        )
        result_name = input_serializer.validated_data["result"]

        try:
            result = process_payment_event(
                provider="sandbox",
                event_id=(
                    f"sandbox-complete-{payment.id}-{result_name}"
                ),
                event_type=f"payment.{result_name}",
                provider_reference=payment.provider_reference,
                amount=payment.amount,
                currency=payment.currency,
            )
        except PaymentNotFound as exc:
            raise Http404 from exc
        except PaymentPayloadMismatch:
            return Response(
                {"detail": "Payment məlumatları uyğun deyil."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if result.conflict:
            return Response(
                {"detail": result.conflict},
                status=status.HTTP_409_CONFLICT,
            )

        return Response(
            PaymentReadSerializer(result.payment).data,
            status=status.HTTP_200_OK,
        )


class SandboxPaymentWebhookAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @staticmethod
    def has_valid_signature(raw_body, provided_signature):
        secret = settings.PAYMENT_WEBHOOK_SECRET

        if not secret or not provided_signature:
            return False

        expected_signature = "sha256=" + hmac.new(
            secret.encode(),
            raw_body,
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(
            provided_signature,
            expected_signature,
        )

    @extend_schema(
        operation_id="sandbox_payment_webhook",
        auth=[],
        description=(
            "Signed, idempotent sandbox payment webhook. Send a SHA-256 "
            "HMAC signature in X-HARA-SIGNATURE. Duplicate provider event "
            "IDs do not issue additional tickets."
        ),
        request=SandboxPaymentWebhookSerializer,
        parameters=[
            OpenApiParameter(
                "X-HARA-SIGNATURE",
                OpenApiTypes.STR,
                location=OpenApiParameter.HEADER,
                required=True,
                description=(
                    "HMAC signature in sha256=<hex-digest> format. "
                    "The signing secret is never exposed."
                ),
            )
        ],
        responses={
            200: WebhookOutcomeSerializer,
            400: OpenApiResponse(
                description="Malformed or mismatched webhook payload."
            ),
            401: DetailErrorSerializer,
            404: DetailErrorSerializer,
            409: DetailErrorSerializer,
        },
    )
    def post(self, request):
        raw_body = request.body
        provided_signature = request.headers.get(
            "X-HARA-SIGNATURE",
            "",
        )

        if not self.has_valid_signature(
            raw_body,
            provided_signature,
        ):
            return Response(
                {"detail": "Webhook signature etibarsızdır."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        input_serializer = SandboxPaymentWebhookSerializer(
            data=request.data
        )
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        try:
            result = process_payment_event(
                provider="sandbox",
                event_id=payload["event_id"],
                event_type=payload["event_type"],
                provider_reference=payload[
                    "provider_reference"
                ],
                amount=payload["amount"],
                currency=payload["currency"],
            )
        except PaymentNotFound:
            return Response(
                {"detail": "Payment tapılmadı."},
                status=status.HTTP_404_NOT_FOUND,
            )
        except PaymentPayloadMismatch:
            return Response(
                {
                    "detail": (
                        "Webhook amount və ya currency "
                        "payment ilə uyğun deyil."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if result.conflict:
            return Response(
                {"detail": result.conflict},
                status=status.HTTP_409_CONFLICT,
            )

        return Response(
            {"status": result.outcome},
            status=status.HTTP_200_OK,
        )
