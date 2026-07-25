import hashlib
import hmac
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Prefetch, Q, Sum
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
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

from .models import Order, OrderItem, Payment, TicketType
from .payments.services import (
    PaymentNotFound,
    PaymentOrderNotFound,
    PaymentPayloadMismatch,
    PaymentProviderUnavailable,
    initiate_payment,
    process_payment_event,
)
from .serializers import (
    OrderCreateSerializer,
    OrderReadSerializer,
    OrganizerTicketTypeSerializer,
    PaymentReadSerializer,
    SandboxPaymentCompleteSerializer,
    SandboxPaymentWebhookSerializer,
)


def order_read_queryset():
    return Order.objects.prefetch_related(
        Prefetch(
            "items",
            queryset=OrderItem.objects.select_related(
                "ticket_type__event"
            ).order_by("id"),
        )
    )


def expire_pending_orders(queryset, now):
    return queryset.filter(
        status=Order.Status.PENDING,
        expires_at__isnull=False,
        expires_at__lte=now,
    ).update(
        status=Order.Status.EXPIRED,
        updated_at=now,
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
        return (
            self.get_event()
            .ticket_types
            .all()
            .order_by("price", "id")
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["event"] = self.get_event()
        return context

    def perform_create(self, serializer):
        serializer.save(event=self.get_event())


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

    def update(self, request, *args, **kwargs):
        ticket_type = self.get_object()

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

        return super().update(request, *args, **kwargs)

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

    def get(self, request):
        queryset = order_read_queryset().filter(
            buyer=request.user
        )
        expire_pending_orders(queryset, timezone.now())

        return Response(
            OrderReadSerializer(queryset, many=True).data,
            status=status.HTTP_200_OK,
        )

    @transaction.atomic
    def post(self, request):
        input_serializer = OrderCreateSerializer(
            data=request.data
        )
        input_serializer.is_valid(raise_exception=True)

        requested_items = input_serializer.validated_data["items"]
        quantities = {
            item["ticket_type_id"]: item["quantity"]
            for item in requested_items
        }
        ticket_type_ids = sorted(quantities)

        locked_ticket_types = {
            ticket_type.id: ticket_type
            for ticket_type in (
                TicketType.objects
                .select_for_update()
                .select_related("event")
                .filter(id__in=ticket_type_ids)
            )
        }

        if len(locked_ticket_types) != len(ticket_type_ids):
            return Response(
                {"detail": "Bilet növlərindən biri tapılmadı."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        event_ids = {
            ticket_type.event_id
            for ticket_type in locked_ticket_types.values()
        }

        if len(event_ids) != 1:
            return Response(
                {
                    "detail": (
                        "Bir sifariş yalnız bir tədbirə aid "
                        "biletlərdən ibarət ola bilər."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        first_ticket_type = locked_ticket_types[ticket_type_ids[0]]
        event = first_ticket_type.event

        if event.status != Event.Status.PUBLISHED:
            return Response(
                {"detail": "Bu tədbir hazırda satışda deyil."},
                status=status.HTTP_409_CONFLICT,
            )

        if event.start_at <= now:
            return Response(
                {"detail": "Başlamış tədbir üçün bilet almaq olmaz."},
                status=status.HTTP_409_CONFLICT,
            )

        total_amount = Decimal("0.00")
        order_item_values = []

        for ticket_type_id in ticket_type_ids:
            ticket_type = locked_ticket_types[ticket_type_id]
            quantity = quantities[ticket_type_id]

            if not ticket_type.is_active:
                return Response(
                    {
                        "detail": (
                            f"“{ticket_type.name}” bilet növü "
                            "aktiv deyil."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            if (
                ticket_type.sales_start_at
                and now < ticket_type.sales_start_at
            ):
                return Response(
                    {
                        "detail": (
                            f"“{ticket_type.name}” bileti üzrə "
                            "satış hələ başlamayıb."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            if (
                ticket_type.sales_end_at
                and now >= ticket_type.sales_end_at
            ):
                return Response(
                    {
                        "detail": (
                            f"“{ticket_type.name}” bileti üzrə "
                            "satış başa çatıb."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            if quantity > ticket_type.max_per_order:
                return Response(
                    {
                        "detail": (
                            f"“{ticket_type.name}” üçün bir sifarişdə "
                            f"maksimum {ticket_type.max_per_order} "
                            "bilet almaq olar."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            reserved_quantity = (
                OrderItem.objects
                .filter(ticket_type=ticket_type)
                .filter(
                    Q(order__status=Order.Status.PAID)
                    | Q(
                        order__status=Order.Status.PENDING,
                        order__expires_at__gt=now,
                    )
                )
                .aggregate(total=Sum("quantity"))["total"]
                or 0
            )

            available_quantity = (
                ticket_type.capacity - reserved_quantity
            )

            if quantity > available_quantity:
                return Response(
                    {
                        "detail": (
                            f"“{ticket_type.name}” üçün yalnız "
                            f"{max(available_quantity, 0)} bilet qalıb."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            total_amount += ticket_type.price * quantity
            order_item_values.append(
                {
                    "ticket_type": ticket_type,
                    "quantity": quantity,
                    "unit_price": ticket_type.price,
                }
            )

        order = Order.objects.create(
            buyer=request.user,
            status=Order.Status.PENDING,
            total_amount=total_amount,
            currency="AZN",
            expires_at=now + timedelta(minutes=15),
        )

        OrderItem.objects.bulk_create(
            [
                OrderItem(
                    order=order,
                    **item_values,
                )
                for item_values in order_item_values
            ]
        )

        order = order_read_queryset().get(pk=order.pk)
        output_serializer = OrderReadSerializer(order)

        return Response(
            output_serializer.data,
            status=status.HTTP_201_CREATED,
        )


class OrderDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, order_id):
        owned_orders = Order.objects.filter(buyer=request.user)
        expire_pending_orders(
            owned_orders.filter(pk=order_id),
            timezone.now(),
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


class PaymentInitiateAPIView(APIView):
    permission_classes = [IsAuthenticated]

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
