import hashlib
import hmac
import json
import uuid
from datetime import timedelta
from decimal import Decimal
from io import StringIO
from threading import Barrier, Thread

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.db import (
    IntegrityError,
    close_old_connections,
    transaction,
)
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from events.models import (
    Category,
    Event,
    Venue,
    VenuePlan,
    VenueSection,
)

from .checkins.services import check_in_ticket
from .inventory import get_inventory_snapshot
from .models import (
    Order,
    OrderIdempotencyKey,
    OrderItem,
    Payment,
    PaymentWebhookEvent,
    Ticket,
    TicketType,
)
from .orders.expiration import expire_pending_orders


User = get_user_model()


class OrganizerTicketTypeAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = User.objects.create_user(
            email="ticket-organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
        )
        cls.other_organizer = User.objects.create_user(
            email="ticket-other@hara.today",
            password="StrongPass123!",
            account_type="organizer",
        )
        cls.attendee = User.objects.create_user(
            email="ticket-buyer@hara.today",
            password="StrongPass123!",
            account_type="user",
        )

        cls.category = Category.objects.create(
            name="Ticket Test",
            slug="ticket-test-category",
        )
        cls.venue = Venue.objects.create(
            name="Ticket Test Məkanı",
            city="Bakı",
            address="Test ünvanı 1",
            location=Point(49.84, 40.37, srid=4326),
        )

        start_at = timezone.now() + timedelta(days=20)

        cls.event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Organizer Ticket Test Event",
            description="Bilet növləri üçün test tədbiri",
            start_at=start_at,
            end_at=start_at + timedelta(hours=2),
            status=Event.Status.DRAFT,
        )
        cls.other_event = Event.objects.create(
            organizer=cls.other_organizer,
            category=cls.category,
            venue=cls.venue,
            title="Other Organizer Event",
            description="Başqa təşkilatçının tədbiri",
            start_at=start_at,
            end_at=start_at + timedelta(hours=2),
            status=Event.Status.DRAFT,
        )

        cls.editable_ticket_type = TicketType.objects.create(
            event=cls.event,
            name="Standart",
            price=Decimal("20.00"),
            capacity=100,
            max_per_order=5,
            sales_start_at=timezone.now(),
            sales_end_at=start_at - timedelta(hours=1),
        )
        cls.locked_ticket_type = TicketType.objects.create(
            event=cls.event,
            name="VIP",
            price=Decimal("50.00"),
            capacity=20,
            max_per_order=2,
            sales_start_at=timezone.now(),
            sales_end_at=start_at - timedelta(hours=1),
        )

        order = Order.objects.create(
            buyer=cls.attendee,
            status=Order.Status.PAID,
            total_amount=Decimal("50.00"),
            paid_at=timezone.now(),
        )
        order_item = OrderItem.objects.create(
            order=order,
            ticket_type=cls.locked_ticket_type,
            quantity=1,
            unit_price=Decimal("50.00"),
        )
        cls.ticket = Ticket.objects.create(
            order_item=order_item,
            event=cls.event,
            owner=cls.attendee,
            status=Ticket.Status.VALID,
        )

    def setUp(self):
        self.client.force_authenticate(user=self.organizer)

    def list_url(self, event=None):
        event = event or self.event
        return reverse(
            "organizer-ticket-type-list",
            kwargs={"event_slug": event.slug},
        )

    def detail_url(self, ticket_type):
        return reverse(
            "organizer-ticket-type-detail",
            kwargs={
                "event_slug": ticket_type.event.slug,
                "pk": ticket_type.pk,
            },
        )

    def test_organizer_sees_own_event_ticket_types(self):
        response = self.client.get(self.list_url())

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        returned_ids = {item["id"] for item in response.json()}

        self.assertIn(self.editable_ticket_type.id, returned_ids)
        self.assertIn(self.locked_ticket_type.id, returned_ids)

    def test_create_ticket_type(self):
        response = self.client.post(
            self.list_url(),
            {
                "name": "Early Bird",
                "price": "10.00",
                "capacity": 50,
                "max_per_order": 4,
                "sales_start_at": timezone.now().isoformat(),
                "sales_end_at": (
                    self.event.start_at - timedelta(days=1)
                ).isoformat(),
                "is_active": True,
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED,
        )

        created = TicketType.objects.get(id=response.json()["id"])
        self.assertEqual(created.event, self.event)

    def test_attendee_cannot_access_ticket_type_api(self):
        self.client.force_authenticate(user=self.attendee)

        response = self.client.get(self.list_url())

        self.assertEqual(
            response.status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_other_organizer_event_returns_404(self):
        response = self.client.get(self.list_url(self.other_event))

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_duplicate_name_is_rejected(self):
        response = self.client.post(
            self.list_url(),
            {
                "name": "standart",
                "price": "25.00",
                "capacity": 50,
                "max_per_order": 5,
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertIn("name", response.json())

    def test_max_per_order_cannot_exceed_capacity(self):
        response = self.client.post(
            self.list_url(),
            {
                "name": "Premium",
                "price": "30.00",
                "capacity": 5,
                "max_per_order": 6,
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertIn("max_per_order", response.json())

    def test_sales_cannot_end_after_event_starts(self):
        response = self.client.post(
            self.list_url(),
            {
                "name": "Late Ticket",
                "price": "15.00",
                "capacity": 20,
                "max_per_order": 2,
                "sales_end_at": (
                    self.event.start_at + timedelta(hours=1)
                ).isoformat(),
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertIn("sales_end_at", response.json())

    def test_unsold_ticket_type_can_be_edited(self):
        response = self.client.patch(
            self.detail_url(self.editable_ticket_type),
            {"price": "25.00"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.editable_ticket_type.refresh_from_db()
        self.assertEqual(
            self.editable_ticket_type.price,
            Decimal("25.00"),
        )

    def test_unsold_ticket_type_can_be_deleted(self):
        response = self.client.delete(
            self.detail_url(self.editable_ticket_type)
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_204_NO_CONTENT,
        )
        self.assertFalse(
            TicketType.objects.filter(
                id=self.editable_ticket_type.id
            ).exists()
        )

    def test_sold_ticket_type_can_be_deactivated(self):
        response = self.client.patch(
            self.detail_url(self.locked_ticket_type),
            {"is_active": False},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.locked_ticket_type.refresh_from_db()
        self.assertFalse(self.locked_ticket_type.is_active)

    def test_sold_ticket_type_price_cannot_be_changed(self):
        response = self.client.patch(
            self.detail_url(self.locked_ticket_type),
            {"price": "60.00"},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )

        self.locked_ticket_type.refresh_from_db()
        self.assertEqual(
            self.locked_ticket_type.price,
            Decimal("50.00"),
        )

    def test_sold_ticket_type_cannot_be_deleted(self):
        response = self.client.delete(
            self.detail_url(self.locked_ticket_type)
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertTrue(
            TicketType.objects.filter(
                id=self.locked_ticket_type.id
            ).exists()
        )

    def test_refunded_ticket_still_keeps_ticket_type_locked(self):
        self.ticket.status = Ticket.Status.REFUNDED
        self.ticket.save(update_fields=["status"])

        response = self.client.patch(
            self.detail_url(self.locked_ticket_type),
            {"capacity": 30},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )


class OrderCreateAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = User.objects.create_user(
            email="checkout-organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
        )
        cls.buyer = User.objects.create_user(
            email="checkout-buyer@hara.today",
            password="StrongPass123!",
            account_type="user",
        )

        cls.category = Category.objects.create(
            name="Checkout Test",
            slug="checkout-test-category",
        )
        cls.venue = Venue.objects.create(
            name="Checkout Test Məkanı",
            city="Bakı",
            address="Checkout test ünvanı",
            location=Point(49.84, 40.37, srid=4326),
        )

        cls.event_start = timezone.now() + timedelta(days=20)

        cls.event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Checkout Published Event",
            description="Checkout üçün yayımlanmış tədbir",
            start_at=cls.event_start,
            end_at=cls.event_start + timedelta(hours=2),
            status=Event.Status.PUBLISHED,
        )

        cls.other_event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Checkout Other Event",
            description="Digər checkout tədbiri",
            start_at=cls.event_start,
            end_at=cls.event_start + timedelta(hours=2),
            status=Event.Status.PUBLISHED,
        )

        cls.standard = TicketType.objects.create(
            event=cls.event,
            name="Standart",
            price=Decimal("20.00"),
            capacity=5,
            max_per_order=3,
            sales_start_at=timezone.now() - timedelta(days=1),
            sales_end_at=cls.event_start - timedelta(hours=1),
            is_active=True,
        )

        cls.vip = TicketType.objects.create(
            event=cls.event,
            name="VIP",
            price=Decimal("50.00"),
            capacity=10,
            max_per_order=2,
            sales_start_at=timezone.now() - timedelta(days=1),
            sales_end_at=cls.event_start - timedelta(hours=1),
            is_active=True,
        )

        cls.other_event_ticket = TicketType.objects.create(
            event=cls.other_event,
            name="Digər tədbir bileti",
            price=Decimal("15.00"),
            capacity=10,
            max_per_order=2,
            sales_start_at=timezone.now() - timedelta(days=1),
            sales_end_at=cls.event_start - timedelta(hours=1),
            is_active=True,
        )

    def setUp(self):
        self.url = reverse("order-create")
        self.client.force_authenticate(user=self.buyer)

    def create_existing_order(
        self,
        *,
        ticket_type,
        quantity,
        order_status,
        expires_at=None,
    ):
        order = Order.objects.create(
            buyer=self.buyer,
            status=order_status,
            total_amount=ticket_type.price * quantity,
            currency="AZN",
            expires_at=expires_at,
        )

        OrderItem.objects.create(
            order=order,
            ticket_type=ticket_type,
            quantity=quantity,
            unit_price=ticket_type.price,
        )

        return order

    def test_authentication_is_required(self):
        self.client.force_authenticate(user=None)

        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 1,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_order_is_created_with_server_calculated_total(self):
        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 2,
                    },
                    {
                        "ticket_type_id": self.vip.id,
                        "quantity": 1,
                    },
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(response.json()["status"], "pending")
        self.assertEqual(response.json()["total_amount"], "90.00")
        self.assertEqual(response.json()["currency"], "AZN")
        self.assertEqual(len(response.json()["items"]), 2)

        order = Order.objects.get(id=response.json()["id"])

        self.assertEqual(order.buyer, self.buyer)
        self.assertEqual(order.status, Order.Status.PENDING)
        self.assertEqual(order.total_amount, Decimal("90.00"))
        self.assertEqual(order.items.count(), 2)
        self.assertIsNotNone(order.expires_at)
        self.assertGreater(
            order.expires_at,
            timezone.now() + timedelta(minutes=14),
        )
        self.assertLess(
            order.expires_at,
            timezone.now() + timedelta(minutes=16),
        )

    def test_unknown_ticket_type_is_rejected(self):
        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": 999999,
                        "quantity": 1,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Order.objects.count(), 0)

    def test_duplicate_ticket_type_is_rejected(self):
        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 1,
                    },
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 2,
                    },
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Order.objects.count(), 0)

    def test_different_events_cannot_be_combined(self):
        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 1,
                    },
                    {
                        "ticket_type_id": self.other_event_ticket.id,
                        "quantity": 1,
                    },
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Order.objects.count(), 0)

    def test_unpublished_event_is_rejected(self):
        self.event.status = Event.Status.DRAFT
        self.event.save(update_fields=["status"])

        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 1,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(Order.objects.count(), 0)

    def test_inactive_ticket_type_is_rejected(self):
        self.standard.is_active = False
        self.standard.save(update_fields=["is_active"])

        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 1,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(Order.objects.count(), 0)

    def test_ticket_sale_that_has_not_started_is_rejected(self):
        self.standard.sales_start_at = (
            timezone.now() + timedelta(days=1)
        )
        self.standard.save(update_fields=["sales_start_at"])

        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 1,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )

    def test_ended_ticket_sale_is_rejected(self):
        self.standard.sales_end_at = (
            timezone.now() - timedelta(minutes=1)
        )
        self.standard.save(update_fields=["sales_end_at"])

        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 1,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )

    def test_max_per_order_is_enforced(self):
        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 4,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Order.objects.count(), 0)

    def test_active_pending_reservation_reduces_available_stock(self):
        self.create_existing_order(
            ticket_type=self.standard,
            quantity=3,
            order_status=Order.Status.PENDING,
            expires_at=timezone.now() + timedelta(minutes=10),
        )

        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 3,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertIn("2 bilet qalıb", response.json()["detail"])

    def test_expired_reservation_does_not_reduce_stock(self):
        self.create_existing_order(
            ticket_type=self.standard,
            quantity=5,
            order_status=Order.Status.PENDING,
            expires_at=timezone.now() - timedelta(minutes=1),
        )

        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 3,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED,
        )

    def test_paid_order_permanently_reduces_available_stock(self):
        self.create_existing_order(
            ticket_type=self.standard,
            quantity=4,
            order_status=Order.Status.PAID,
            expires_at=timezone.now() - timedelta(days=1),
        )

        response = self.client.post(
            self.url,
            {
                "items": [
                    {
                        "ticket_type_id": self.standard.id,
                        "quantity": 2,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertIn("1 bilet qalıb", response.json()["detail"])


class OrderLifecycleAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = User.objects.create_user(
            email="lifecycle-organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
        )
        cls.buyer = User.objects.create_user(
            email="lifecycle-buyer@hara.today",
            password="StrongPass123!",
            account_type="user",
        )
        cls.other_buyer = User.objects.create_user(
            email="lifecycle-other-buyer@hara.today",
            password="StrongPass123!",
            account_type="user",
        )

        cls.category = Category.objects.create(
            name="Order Lifecycle Test",
            slug="order-lifecycle-test-category",
        )
        cls.venue = Venue.objects.create(
            name="Order Lifecycle Test Məkanı",
            city="Bakı",
            address="Order lifecycle test ünvanı",
            location=Point(49.84, 40.37, srid=4326),
        )

        event_start = timezone.now() + timedelta(days=20)

        cls.event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Lifecycle Published Event",
            description="Order lifecycle üçün test tədbiri",
            start_at=event_start,
            end_at=event_start + timedelta(hours=2),
            status=Event.Status.PUBLISHED,
        )
        cls.ticket_type = TicketType.objects.create(
            event=cls.event,
            name="Lifecycle Ticket",
            price=Decimal("25.00"),
            capacity=3,
            max_per_order=3,
            sales_start_at=timezone.now() - timedelta(days=1),
            sales_end_at=event_start - timedelta(hours=1),
            is_active=True,
        )

    def setUp(self):
        self.list_url = reverse("order-create")
        self.client.force_authenticate(user=self.buyer)

    def create_order(
        self,
        *,
        buyer=None,
        order_status=Order.Status.PENDING,
        expires_at=None,
        quantity=1,
    ):
        order = Order.objects.create(
            buyer=buyer or self.buyer,
            status=order_status,
            total_amount=self.ticket_type.price * quantity,
            currency="AZN",
            expires_at=expires_at,
        )
        OrderItem.objects.create(
            order=order,
            ticket_type=self.ticket_type,
            quantity=quantity,
            unit_price=self.ticket_type.price,
        )
        return order

    @staticmethod
    def detail_url(order):
        return reverse(
            "order-detail",
            kwargs={"order_id": order.id},
        )

    @staticmethod
    def cancel_url(order):
        return reverse(
            "order-cancel",
            kwargs={"order_id": order.id},
        )

    def test_lifecycle_endpoints_require_authentication(self):
        order = self.create_order(
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        requests = [
            ("get", self.list_url),
            ("get", self.detail_url(order)),
            ("post", self.cancel_url(order)),
        ]
        self.client.force_authenticate(user=None)

        for method, url in requests:
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url)

                self.assertEqual(
                    response.status_code,
                    status.HTTP_401_UNAUTHORIZED,
                )

    def test_user_sees_only_own_order_list(self):
        own_order = self.create_order(
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        self.create_order(
            buyer=self.other_buyer,
            expires_at=timezone.now() + timedelta(minutes=10),
        )

        response = self.client.get(self.list_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response_data = response.json()
        self.assertEqual(
            [item["id"] for item in response_data],
            [str(own_order.id)],
        )
        self.assertIn("updated_at", response_data[0])
        self.assertEqual(
            response_data[0]["items"][0]["event_slug"],
            self.event.slug,
        )
        self.assertEqual(
            response_data[0]["items"][0]["event_title"],
            self.event.title,
        )

    def test_order_detail_returns_own_order(self):
        order = self.create_order(
            expires_at=timezone.now() + timedelta(minutes=10),
        )

        response = self.client.get(self.detail_url(order))

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        response_data = response.json()
        self.assertEqual(response_data["id"], str(order.id))
        self.assertEqual(response_data["status"], Order.Status.PENDING)
        self.assertIn("updated_at", response_data)
        self.assertEqual(len(response_data["items"]), 1)
        self.assertEqual(
            response_data["items"][0]["event_slug"],
            self.event.slug,
        )
        self.assertEqual(
            response_data["items"][0]["event_title"],
            self.event.title,
        )

    def test_other_users_order_detail_returns_404(self):
        order = self.create_order(
            buyer=self.other_buyer,
            expires_at=timezone.now() + timedelta(minutes=10),
        )

        response = self.client.get(self.detail_url(order))

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_active_pending_order_can_be_cancelled(self):
        order = self.create_order(
            expires_at=timezone.now() + timedelta(minutes=10),
        )

        response = self.client.post(self.cancel_url(order))

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CANCELLED)

    def test_cancelled_order_releases_stock_immediately(self):
        order = self.create_order(
            expires_at=timezone.now() + timedelta(minutes=10),
            quantity=self.ticket_type.capacity,
        )
        payload = {
            "items": [
                {
                    "ticket_type_id": self.ticket_type.id,
                    "quantity": 1,
                }
            ]
        }

        blocked_response = self.client.post(
            self.list_url,
            payload,
            format="json",
        )
        cancel_response = self.client.post(self.cancel_url(order))
        released_response = self.client.post(
            self.list_url,
            {
                "items": [
                    {
                        "ticket_type_id": self.ticket_type.id,
                        "quantity": self.ticket_type.capacity,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(
            blocked_response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(
            cancel_response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            released_response.status_code,
            status.HTTP_201_CREATED,
        )

    def test_paid_and_other_terminal_orders_cannot_be_cancelled(self):
        terminal_statuses = [
            Order.Status.PAID,
            Order.Status.FAILED,
            Order.Status.EXPIRED,
            Order.Status.REFUNDED,
            Order.Status.CANCELLED,
        ]

        for order_status in terminal_statuses:
            with self.subTest(order_status=order_status):
                order = self.create_order(
                    order_status=order_status,
                    expires_at=(
                        timezone.now() + timedelta(minutes=10)
                    ),
                )

                response = self.client.post(self.cancel_url(order))

                self.assertEqual(
                    response.status_code,
                    status.HTTP_409_CONFLICT,
                )
                order.refresh_from_db()
                self.assertEqual(order.status, order_status)

    def test_pending_orders_expire_on_list_and_detail_but_null_does_not(
        self,
    ):
        list_order = self.create_order(
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        null_expiry_order = self.create_order(expires_at=None)

        list_response = self.client.get(self.list_url)

        self.assertEqual(
            list_response.status_code,
            status.HTTP_200_OK,
        )
        list_order.refresh_from_db()
        null_expiry_order.refresh_from_db()
        self.assertEqual(list_order.status, Order.Status.EXPIRED)
        self.assertEqual(
            null_expiry_order.status,
            Order.Status.PENDING,
        )
        list_statuses = {
            item["id"]: item["status"]
            for item in list_response.json()
        }
        self.assertEqual(
            list_statuses[str(list_order.id)],
            Order.Status.EXPIRED,
        )
        self.assertEqual(
            list_statuses[str(null_expiry_order.id)],
            Order.Status.PENDING,
        )

        detail_order = self.create_order(
            expires_at=timezone.now() - timedelta(minutes=1),
        )

        detail_response = self.client.get(
            self.detail_url(detail_order)
        )

        self.assertEqual(
            detail_response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            detail_response.json()["status"],
            Order.Status.EXPIRED,
        )
        detail_order.refresh_from_db()
        self.assertEqual(detail_order.status, Order.Status.EXPIRED)

    def test_elapsed_pending_order_cannot_be_cancelled(self):
        order = self.create_order(
            expires_at=timezone.now() - timedelta(minutes=1),
        )

        response = self.client.post(self.cancel_url(order))

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.EXPIRED)

    def test_other_users_order_cannot_be_cancelled(self):
        order = self.create_order(
            buyer=self.other_buyer,
            expires_at=timezone.now() + timedelta(minutes=10),
        )

        response = self.client.post(self.cancel_url(order))

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PENDING)

    def test_repeated_cancel_returns_409(self):
        order = self.create_order(
            expires_at=timezone.now() + timedelta(minutes=10),
        )

        first_response = self.client.post(self.cancel_url(order))
        repeated_response = self.client.post(self.cancel_url(order))

        self.assertEqual(
            first_response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            repeated_response.status_code,
            status.HTTP_409_CONFLICT,
        )
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.CANCELLED)


@override_settings(
    PAYMENT_PROVIDER="sandbox",
    PAYMENT_SANDBOX_ENABLED=True,
    PAYMENT_WEBHOOK_SECRET="payment-test-secret",
)
class SandboxPaymentAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = User.objects.create_user(
            email="payment-organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
        )
        cls.buyer = User.objects.create_user(
            email="payment-buyer@hara.today",
            password="StrongPass123!",
            account_type="user",
        )
        cls.other_buyer = User.objects.create_user(
            email="payment-other-buyer@hara.today",
            password="StrongPass123!",
            account_type="user",
        )
        cls.category = Category.objects.create(
            name="Sandbox Payment Test",
            slug="sandbox-payment-test-category",
        )
        cls.venue = Venue.objects.create(
            name="Sandbox Payment Test Məkanı",
            city="Bakı",
            address="Sandbox payment test ünvanı",
            location=Point(49.84, 40.37, srid=4326),
        )
        event_start = timezone.now() + timedelta(days=20)
        cls.event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Sandbox Payment Published Event",
            description="Sandbox payment axını üçün test tədbiri",
            start_at=event_start,
            end_at=event_start + timedelta(hours=2),
            status=Event.Status.PUBLISHED,
        )
        cls.ticket_type = TicketType.objects.create(
            event=cls.event,
            name="Sandbox Payment Ticket",
            price=Decimal("25.00"),
            capacity=100,
            max_per_order=10,
            sales_start_at=timezone.now() - timedelta(days=1),
            sales_end_at=event_start - timedelta(hours=1),
            is_active=True,
        )
        cls.free_ticket_type = TicketType.objects.create(
            event=cls.event,
            name="Free Sandbox Payment Ticket",
            price=Decimal("0.00"),
            capacity=100,
            max_per_order=10,
            sales_start_at=timezone.now() - timedelta(days=1),
            sales_end_at=event_start - timedelta(hours=1),
            is_active=True,
        )

    def setUp(self):
        self.client.force_authenticate(user=self.buyer)
        self.webhook_url = reverse("sandbox-payment-webhook")

    def create_order(
        self,
        *,
        buyer=None,
        order_status=Order.Status.PENDING,
        expires_at=None,
        ticket_type=None,
        quantity=1,
        total_amount=None,
        currency="AZN",
    ):
        buyer = buyer or self.buyer
        ticket_type = ticket_type or self.ticket_type

        if expires_at is None:
            expires_at = timezone.now() + timedelta(minutes=10)

        if total_amount is None:
            total_amount = ticket_type.price * quantity

        order = Order.objects.create(
            buyer=buyer,
            status=order_status,
            total_amount=total_amount,
            currency=currency,
            expires_at=expires_at,
        )
        order_item = OrderItem.objects.create(
            order=order,
            ticket_type=ticket_type,
            quantity=quantity,
            unit_price=ticket_type.price,
        )
        return order, order_item

    def create_initiated_payment(self, order):
        return Payment.objects.create(
            order=order,
            status=Payment.Status.INITIATED,
            amount=order.total_amount,
            currency=order.currency,
            provider="sandbox",
            provider_reference=f"sandbox_test_{uuid.uuid4().hex}",
            checkout_url=None,
        )

    @staticmethod
    def initiation_url(order):
        return reverse(
            "payment-initiate",
            kwargs={"order_id": order.id},
        )

    @staticmethod
    def completion_url(payment):
        return reverse(
            "sandbox-payment-complete",
            kwargs={"payment_id": payment.id},
        )

    @staticmethod
    def webhook_signature(body):
        digest = hmac.new(
            settings.PAYMENT_WEBHOOK_SECRET.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        return f"sha256={digest}"

    def post_webhook_body(self, body, *, signature=None):
        if signature is None:
            signature = self.webhook_signature(body)

        return self.client.post(
            self.webhook_url,
            data=body,
            content_type="application/json",
            HTTP_X_HARA_SIGNATURE=signature,
        )

    def post_webhook(self, payload, *, signature=None):
        body = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        return self.post_webhook_body(
            body,
            signature=signature,
        )

    @staticmethod
    def webhook_payload(
        payment,
        *,
        event_type="payment.succeeded",
        event_id=None,
        amount=None,
        currency=None,
    ):
        return {
            "event_id": event_id or f"event-{uuid.uuid4().hex}",
            "event_type": event_type,
            "provider_reference": payment.provider_reference,
            "amount": (
                str(payment.amount)
                if amount is None
                else amount
            ),
            "currency": payment.currency if currency is None else currency,
        }

    def test_payment_initiation_requires_authentication(self):
        order, _ = self.create_order()
        self.client.force_authenticate(user=None)

        response = self.client.post(self.initiation_url(order))

        self.assertEqual(
            response.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(Payment.objects.count(), 0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PENDING)

    def test_user_cannot_initiate_payment_for_another_users_order(self):
        order, _ = self.create_order(buyer=self.other_buyer)

        response = self.client.post(self.initiation_url(order))

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(Payment.objects.count(), 0)

    def test_pending_order_creates_sandbox_payment(self):
        order, _ = self.create_order(quantity=2)

        response = self.client.post(self.initiation_url(order))

        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(Payment.objects.count(), 1)
        response_data = response.json()
        self.assertEqual(
            set(response_data),
            {
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
            },
        )
        self.assertEqual(response_data["order_id"], str(order.id))
        self.assertEqual(
            response_data["status"],
            Payment.Status.INITIATED,
        )
        self.assertEqual(response_data["amount"], "50.00")
        self.assertEqual(response_data["currency"], "AZN")
        self.assertEqual(response_data["provider"], "sandbox")
        self.assertTrue(response_data["provider_reference"])
        self.assertEqual(
            response_data["checkout_url"],
            reverse(
                "sandbox-payment-complete",
                kwargs={"payment_id": response_data["id"]},
            ),
        )
        self.assertTrue(response_data["created_at"])
        self.assertTrue(response_data["updated_at"])

    def test_payment_values_are_always_taken_from_server_order(self):
        order, _ = self.create_order(quantity=2)
        forged_payload = {
            "amount": "0.01",
            "currency": "USD",
            "provider": "forged-provider",
            "card_number": "4111111111111111",
            "cvv": "123",
        }

        response = self.client.post(
            self.initiation_url(order),
            forged_payload,
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED,
        )
        payment = Payment.objects.get()
        self.assertEqual(payment.amount, order.total_amount)
        self.assertEqual(payment.currency, order.currency)
        self.assertEqual(payment.provider, "sandbox")
        self.assertEqual(response.json()["amount"], "50.00")
        self.assertEqual(response.json()["currency"], "AZN")
        self.assertEqual(response.json()["provider"], "sandbox")
        self.assertNotIn("card_number", response.json())
        self.assertNotIn("cvv", response.json())

    def test_repeated_initiation_returns_same_payment(self):
        order, _ = self.create_order()

        first_response = self.client.post(
            self.initiation_url(order)
        )
        repeated_response = self.client.post(
            self.initiation_url(order)
        )

        self.assertEqual(
            first_response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            repeated_response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(Payment.objects.count(), 1)
        self.assertEqual(
            first_response.json()["id"],
            repeated_response.json()["id"],
        )
        self.assertEqual(
            first_response.json()["provider_reference"],
            repeated_response.json()["provider_reference"],
        )

    def test_sandbox_provider_references_are_unique(self):
        first_order, _ = self.create_order()
        second_order, _ = self.create_order()

        first_response = self.client.post(
            self.initiation_url(first_order)
        )
        second_response = self.client.post(
            self.initiation_url(second_order)
        )

        self.assertEqual(
            first_response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            second_response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(Payment.objects.count(), 2)
        self.assertNotEqual(
            first_response.json()["provider_reference"],
            second_response.json()["provider_reference"],
        )

    def test_expired_order_blocks_initiation_and_is_marked_expired(self):
        order, _ = self.create_order(
            expires_at=timezone.now() - timedelta(minutes=1),
        )

        response = self.client.post(self.initiation_url(order))

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(Payment.objects.count(), 0)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.EXPIRED)

    def test_terminal_orders_cannot_initiate_payment(self):
        terminal_statuses = [
            Order.Status.CANCELLED,
            Order.Status.PAID,
            Order.Status.FAILED,
            Order.Status.EXPIRED,
            Order.Status.REFUNDED,
        ]

        for order_status in terminal_statuses:
            with self.subTest(order_status=order_status):
                order, _ = self.create_order(
                    order_status=order_status,
                )

                response = self.client.post(
                    self.initiation_url(order)
                )

                self.assertEqual(
                    response.status_code,
                    status.HTTP_409_CONFLICT,
                )
                order.refresh_from_db()
                self.assertEqual(order.status, order_status)

        self.assertEqual(Payment.objects.count(), 0)

    def test_database_allows_only_one_initiated_payment_per_order(self):
        order, _ = self.create_order()
        self.create_initiated_payment(order)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self.create_initiated_payment(order)

        self.assertEqual(
            Payment.objects.filter(
                order=order,
                status=Payment.Status.INITIATED,
            ).count(),
            1,
        )

    def test_sandbox_completion_requires_authentication(self):
        order, _ = self.create_order()
        payment = self.create_initiated_payment(order)
        self.client.force_authenticate(user=None)

        response = self.client.post(
            self.completion_url(payment),
            {"result": "succeeded"},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.INITIATED)
        self.assertEqual(order.status, Order.Status.PENDING)

    @override_settings(PAYMENT_SANDBOX_ENABLED=False)
    def test_disabled_sandbox_completion_returns_404(self):
        order, _ = self.create_order()
        payment = self.create_initiated_payment(order)

        response = self.client.post(
            self.completion_url(payment),
            {"result": "succeeded"},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.INITIATED)
        self.assertEqual(order.status, Order.Status.PENDING)
        self.assertEqual(Ticket.objects.count(), 0)

    def test_user_cannot_complete_another_users_sandbox_payment(self):
        order, _ = self.create_order(buyer=self.other_buyer)
        payment = self.create_initiated_payment(order)

        response = self.client.post(
            self.completion_url(payment),
            {"result": "succeeded"},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.INITIATED)
        self.assertEqual(order.status, Order.Status.PENDING)
        self.assertEqual(Ticket.objects.count(), 0)

    def test_invalid_sandbox_completion_result_is_rejected(self):
        order, _ = self.create_order()
        payment = self.create_initiated_payment(order)

        response = self.client.post(
            self.completion_url(payment),
            {"result": "unknown"},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.INITIATED)
        self.assertEqual(order.status, Order.Status.PENDING)

    def test_successful_sandbox_payment_marks_order_paid(self):
        order, _ = self.create_order()
        payment = self.create_initiated_payment(order)

        response = self.client.post(
            self.completion_url(payment),
            {"result": "succeeded"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.SUCCEEDED)
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertIsNotNone(order.paid_at)
        self.assertEqual(PaymentWebhookEvent.objects.count(), 1)

    def test_successful_sandbox_payment_creates_correct_ticket_count(self):
        order, _ = self.create_order(quantity=3)
        payment = self.create_initiated_payment(order)

        response = self.client.post(
            self.completion_url(payment),
            {"result": "succeeded"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            Ticket.objects.filter(
                order_item__order=order
            ).count(),
            3,
        )

    def test_issued_tickets_have_correct_owner_event_and_qr_codes(self):
        order, order_item = self.create_order(quantity=3)
        payment = self.create_initiated_payment(order)

        response = self.client.post(
            self.completion_url(payment),
            {"result": "succeeded"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        tickets = list(
            Ticket.objects.filter(
                order_item__order=order
            ).order_by("id")
        )
        self.assertEqual(len(tickets), 3)
        self.assertEqual(
            {ticket.order_item_id for ticket in tickets},
            {order_item.id},
        )
        self.assertEqual(
            {ticket.owner_id for ticket in tickets},
            {self.buyer.id},
        )
        self.assertEqual(
            {ticket.event_id for ticket in tickets},
            {self.event.id},
        )
        self.assertEqual(
            {ticket.status for ticket in tickets},
            {Ticket.Status.VALID},
        )
        self.assertEqual(
            len({ticket.qr_code for ticket in tickets}),
            3,
        )
        self.assertTrue(
            all(ticket.qr_code is not None for ticket in tickets)
        )

    def test_repeated_sandbox_completion_does_not_duplicate_tickets(self):
        order, _ = self.create_order(quantity=2)
        payment = self.create_initiated_payment(order)
        completion_url = self.completion_url(payment)

        first_response = self.client.post(
            completion_url,
            {"result": "succeeded"},
            format="json",
        )
        repeated_response = self.client.post(
            completion_url,
            {"result": "succeeded"},
            format="json",
        )

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            repeated_response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(PaymentWebhookEvent.objects.count(), 1)
        self.assertEqual(
            Ticket.objects.filter(
                order_item__order=order
            ).count(),
            2,
        )

    def test_failed_sandbox_payment_marks_order_failed_without_tickets(
        self,
    ):
        order, _ = self.create_order(quantity=2)
        payment = self.create_initiated_payment(order)

        response = self.client.post(
            self.completion_url(payment),
            {"result": "failed"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.FAILED)
        self.assertEqual(order.status, Order.Status.FAILED)
        self.assertEqual(
            Ticket.objects.filter(
                order_item__order=order
            ).count(),
            0,
        )

    def test_webhook_signature_is_required(self):
        order, _ = self.create_order()
        payment = self.create_initiated_payment(order)
        payload = self.webhook_payload(payment)
        body = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()

        response = self.client.post(
            self.webhook_url,
            data=body,
            content_type="application/json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.INITIATED)
        self.assertEqual(order.status, Order.Status.PENDING)
        self.assertEqual(PaymentWebhookEvent.objects.count(), 0)

    def test_invalid_webhook_signature_is_rejected(self):
        order, _ = self.create_order()
        payment = self.create_initiated_payment(order)
        payload = self.webhook_payload(payment)

        response = self.post_webhook(
            payload,
            signature="sha256=invalid",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.INITIATED)
        self.assertEqual(order.status, Order.Status.PENDING)
        self.assertEqual(PaymentWebhookEvent.objects.count(), 0)

    def test_malformed_webhook_payload_is_rejected(self):
        invalid_json_response = self.post_webhook_body(b"{")
        missing_fields_response = self.post_webhook(
            {"event_id": "missing-required-fields"}
        )

        self.assertEqual(
            invalid_json_response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            missing_fields_response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(PaymentWebhookEvent.objects.count(), 0)

    def test_webhook_unknown_provider_reference_returns_404(self):
        payload = {
            "event_id": f"unknown-{uuid.uuid4().hex}",
            "event_type": "payment.succeeded",
            "provider_reference": "sandbox_missing_reference",
            "amount": "25.00",
            "currency": "AZN",
        }

        response = self.post_webhook(payload)

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(PaymentWebhookEvent.objects.count(), 0)
        self.assertEqual(Ticket.objects.count(), 0)

    def test_webhook_amount_or_currency_mismatch_changes_no_status(self):
        mismatches = [
            {"amount": "999.00"},
            {"currency": "USD"},
        ]

        for mismatch in mismatches:
            with self.subTest(mismatch=mismatch):
                order, _ = self.create_order()
                payment = self.create_initiated_payment(order)
                payload = self.webhook_payload(
                    payment,
                    **mismatch,
                )

                response = self.post_webhook(payload)

                self.assertEqual(
                    response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                payment.refresh_from_db()
                order.refresh_from_db()
                self.assertEqual(
                    payment.status,
                    Payment.Status.INITIATED,
                )
                self.assertEqual(order.status, Order.Status.PENDING)
                self.assertEqual(
                    PaymentWebhookEvent.objects.filter(
                        payment=payment
                    ).count(),
                    0,
                )
                self.assertEqual(
                    Ticket.objects.filter(
                        order_item__order=order
                    ).count(),
                    0,
                )

    def test_duplicate_webhook_event_is_idempotent(self):
        order, _ = self.create_order(quantity=2)
        payment = self.create_initiated_payment(order)
        payload = self.webhook_payload(payment)

        first_response = self.post_webhook(payload)
        repeated_response = self.post_webhook(payload)

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            repeated_response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(first_response.json()["status"], "processed")
        self.assertEqual(
            repeated_response.json()["status"],
            "duplicate",
        )
        self.assertEqual(
            PaymentWebhookEvent.objects.filter(
                payment=payment
            ).count(),
            1,
        )
        self.assertEqual(
            Ticket.objects.filter(
                order_item__order=order
            ).count(),
            2,
        )

    def test_distinct_success_events_do_not_duplicate_tickets(self):
        order, _ = self.create_order(quantity=2)
        payment = self.create_initiated_payment(order)
        first_payload = self.webhook_payload(payment)
        second_payload = self.webhook_payload(payment)

        first_response = self.post_webhook(first_payload)
        second_response = self.post_webhook(second_payload)

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            PaymentWebhookEvent.objects.filter(
                payment=payment
            ).count(),
            2,
        )
        self.assertEqual(
            Ticket.objects.filter(
                order_item__order=order
            ).count(),
            2,
        )

    def test_failed_webhook_marks_order_failed_without_tickets(self):
        order, _ = self.create_order(quantity=2)
        payment = self.create_initiated_payment(order)
        payload = self.webhook_payload(
            payment,
            event_type="payment.failed",
        )

        response = self.post_webhook(payload)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.FAILED)
        self.assertEqual(order.status, Order.Status.FAILED)
        self.assertEqual(
            PaymentWebhookEvent.objects.filter(
                payment=payment
            ).count(),
            1,
        )
        self.assertEqual(
            Ticket.objects.filter(
                order_item__order=order
            ).count(),
            0,
        )

    def test_paid_order_is_not_downgraded_by_later_failed_event(self):
        order, _ = self.create_order(quantity=2)
        payment = self.create_initiated_payment(order)
        success_payload = self.webhook_payload(payment)
        failed_payload = self.webhook_payload(
            payment,
            event_type="payment.failed",
        )

        success_response = self.post_webhook(success_payload)
        failed_response = self.post_webhook(failed_payload)

        self.assertEqual(
            success_response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            failed_response.status_code,
            status.HTTP_200_OK,
        )
        payment.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.SUCCEEDED)
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertEqual(
            PaymentWebhookEvent.objects.filter(
                payment=payment
            ).count(),
            2,
        )
        self.assertEqual(
            Ticket.objects.filter(
                order_item__order=order
            ).count(),
            2,
        )

    def test_late_success_for_terminal_order_is_conflict_and_idempotent(
        self,
    ):
        for order_status in [
            Order.Status.EXPIRED,
            Order.Status.CANCELLED,
        ]:
            with self.subTest(order_status=order_status):
                order, _ = self.create_order(
                    order_status=order_status,
                )
                payment = self.create_initiated_payment(order)
                payload = self.webhook_payload(payment)

                first_response = self.post_webhook(payload)
                repeated_response = self.post_webhook(payload)

                self.assertEqual(
                    first_response.status_code,
                    status.HTTP_409_CONFLICT,
                )
                self.assertEqual(
                    repeated_response.status_code,
                    status.HTTP_200_OK,
                )
                payment.refresh_from_db()
                order.refresh_from_db()
                self.assertEqual(
                    payment.status,
                    Payment.Status.SUCCEEDED,
                )
                self.assertEqual(order.status, order_status)
                self.assertEqual(
                    Ticket.objects.filter(
                        order_item__order=order
                    ).count(),
                    0,
                )
                self.assertEqual(
                    PaymentWebhookEvent.objects.filter(
                        payment=payment
                    ).count(),
                    1,
                )

    def test_database_rejects_duplicate_webhook_provider_event_id(self):
        order, _ = self.create_order()
        payment = self.create_initiated_payment(order)
        event_id = f"constraint-{uuid.uuid4().hex}"
        PaymentWebhookEvent.objects.create(
            provider="sandbox",
            event_id=event_id,
            event_type="payment.succeeded",
            payment=payment,
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                PaymentWebhookEvent.objects.create(
                    provider="sandbox",
                    event_id=event_id,
                    event_type="payment.failed",
                    payment=payment,
                )

        self.assertEqual(
            PaymentWebhookEvent.objects.filter(
                provider="sandbox",
                event_id=event_id,
            ).count(),
            1,
        )

    def test_free_order_is_paid_and_issued_once_without_checkout(self):
        order, _ = self.create_order(
            ticket_type=self.free_ticket_type,
            quantity=2,
            total_amount=Decimal("0.00"),
        )

        first_response = self.client.post(
            self.initiation_url(order)
        )
        repeated_response = self.client.post(
            self.initiation_url(order)
        )

        self.assertEqual(
            first_response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            repeated_response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            first_response.json()["id"],
            repeated_response.json()["id"],
        )
        self.assertEqual(first_response.json()["status"], "succeeded")
        self.assertEqual(first_response.json()["provider"], "free")
        self.assertEqual(first_response.json()["amount"], "0.00")
        self.assertEqual(first_response.json()["currency"], "AZN")
        self.assertIsNone(first_response.json()["checkout_url"])
        self.assertEqual(
            Payment.objects.filter(order=order).count(),
            1,
        )
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertIsNotNone(order.paid_at)
        tickets = Ticket.objects.filter(
            order_item__order=order
        )
        self.assertEqual(tickets.count(), 2)
        self.assertEqual(
            set(tickets.values_list("owner_id", flat=True)),
            {self.buyer.id},
        )
        self.assertEqual(
            set(tickets.values_list("event_id", flat=True)),
            {self.event.id},
        )


class TicketAndCheckInAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = User.objects.create_user(
            email="checkin-organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
            display_name="Əsas Organizer",
            phone_number="+994501111111",
        )
        cls.other_organizer = User.objects.create_user(
            email="checkin-other-organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
            display_name="Başqa Organizer",
        )
        cls.superadmin = User.objects.create_superuser(
            email="checkin-superadmin@hara.today",
            password="StrongPass123!",
        )
        cls.buyer = User.objects.create_user(
            email="ticket-api-buyer@hara.today",
            password="StrongPass123!",
            account_type="user",
            display_name="Bilet Sahibi",
            phone_number="+994502222222",
        )
        cls.other_buyer = User.objects.create_user(
            email="ticket-api-other@hara.today",
            password="StrongPass123!",
            account_type="user",
            display_name="Başqa Alıcı",
        )
        cls.category = Category.objects.create(
            name="Ticket API",
            slug="ticket-api-category",
        )
        cls.venue = Venue.objects.create(
            name="Ticket API Məkanı",
            city="Bakı",
            address="Ticket API ünvanı",
            location=Point(49.84, 40.37, srid=4326),
        )
        now = timezone.now()
        cls.upcoming_event = cls.create_event(
            organizer=cls.organizer,
            title="Upcoming Ticket API Event",
            start_at=now + timedelta(days=5),
            end_at=now + timedelta(days=5, hours=2),
        )
        cls.second_event = cls.create_event(
            organizer=cls.organizer,
            title="Second Ticket API Event",
            start_at=now + timedelta(days=8),
            end_at=now + timedelta(days=8, hours=2),
        )
        cls.past_event = cls.create_event(
            organizer=cls.organizer,
            title="Past Ticket API Event",
            start_at=now - timedelta(days=5),
            end_at=now - timedelta(days=5) + timedelta(hours=2),
        )
        cls.foreign_event = cls.create_event(
            organizer=cls.other_organizer,
            title="Foreign Ticket API Event",
            start_at=now + timedelta(days=10),
            end_at=now + timedelta(days=10, hours=2),
        )
        cls.upcoming_ticket = cls.create_ticket(
            event=cls.upcoming_event,
            owner=cls.buyer,
        )
        cls.second_event_ticket = cls.create_ticket(
            event=cls.second_event,
            owner=cls.buyer,
        )
        cls.past_ticket = cls.create_ticket(
            event=cls.past_event,
            owner=cls.buyer,
        )
        cls.foreign_event_ticket = cls.create_ticket(
            event=cls.foreign_event,
            owner=cls.buyer,
        )
        cls.other_buyers_ticket = cls.create_ticket(
            event=cls.upcoming_event,
            owner=cls.other_buyer,
        )

    @classmethod
    def create_event(
        cls,
        *,
        organizer,
        title,
        start_at,
        end_at,
    ):
        return Event.objects.create(
            organizer=organizer,
            category=cls.category,
            venue=cls.venue,
            title=title,
            description=f"{title} description",
            start_at=start_at,
            end_at=end_at,
            status=Event.Status.PUBLISHED,
        )

    @classmethod
    def create_ticket(
        cls,
        *,
        event,
        owner,
        order_status=Order.Status.PAID,
        ticket_status=Ticket.Status.VALID,
    ):
        ticket_type = TicketType.objects.create(
            event=event,
            name=f"Ticket {uuid.uuid4().hex[:8]}",
            price=Decimal("15.00"),
            capacity=100,
            max_per_order=10,
            is_active=True,
        )
        order = Order.objects.create(
            buyer=owner,
            status=order_status,
            total_amount=Decimal("15.00"),
            currency="AZN",
            paid_at=(
                timezone.now()
                if order_status == Order.Status.PAID
                else None
            ),
        )
        order_item = OrderItem.objects.create(
            order=order,
            ticket_type=ticket_type,
            quantity=1,
            unit_price=Decimal("15.00"),
        )
        return Ticket.objects.create(
            order_item=order_item,
            event=event,
            owner=owner,
            status=ticket_status,
        )

    def setUp(self):
        self.client.force_authenticate(user=self.buyer)

    @staticmethod
    def detail_url(ticket):
        return reverse(
            "ticket-detail",
            kwargs={"ticket_id": ticket.id},
        )

    @staticmethod
    def check_in_url(event):
        return reverse(
            "organizer-ticket-check-in",
            kwargs={"event_slug": event.slug},
        )

    def test_ticket_list_requires_authentication(self):
        self.client.force_authenticate(user=None)

        response = self.client.get(reverse("ticket-list"))

        self.assertEqual(
            response.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_ticket_list_returns_only_owned_tickets_newest_first(self):
        older_time = timezone.now() - timedelta(hours=2)
        Ticket.objects.filter(pk=self.upcoming_ticket.pk).update(
            issued_at=older_time
        )

        response = self.client.get(reverse("ticket-list"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response_data = response.json()
        returned_ids = [item["id"] for item in response_data]
        self.assertNotIn(
            str(self.other_buyers_ticket.id),
            returned_ids,
        )
        self.assertEqual(
            set(returned_ids),
            {
                str(self.upcoming_ticket.id),
                str(self.second_event_ticket.id),
                str(self.past_ticket.id),
                str(self.foreign_event_ticket.id),
            },
        )
        self.assertEqual(
            returned_ids[-1],
            str(self.upcoming_ticket.id),
        )
        first_ticket = response_data[0]
        self.assertEqual(
            set(first_ticket),
            {
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
            },
        )
        serialized = json.dumps(response_data, ensure_ascii=False)
        self.assertNotIn(self.buyer.email, serialized)
        self.assertNotIn(self.buyer.phone_number, serialized)

    def test_ticket_wallet_returns_lifecycle_currency_and_stable_qr_payload(
        self,
    ):
        list_response = self.client.get(reverse("ticket-list"))
        list_data = next(
            item
            for item in list_response.json()
            if item["id"] == str(self.upcoming_ticket.id)
        )
        detail_response = self.client.get(
            self.detail_url(self.upcoming_ticket)
        )
        detail_data = detail_response.json()

        self.assertEqual(list_data["status"], Ticket.Status.VALID)
        self.assertEqual(list_data["currency"], "AZN")
        self.assertEqual(
            list_data["qr_code"],
            detail_data["qr_code"],
        )
        self.assertEqual(
            list_data["qr_code"],
            str(self.upcoming_ticket.qr_code),
        )
        uuid.UUID(list_data["qr_code"])

        serialized = json.dumps(detail_data, ensure_ascii=False)
        self.assertNotIn(self.buyer.email, serialized)
        self.assertNotIn(self.buyer.phone_number, serialized)

    def test_ticket_wallet_returns_each_model_lifecycle_status(self):
        for ticket_status in Ticket.Status.values:
            with self.subTest(ticket_status=ticket_status):
                used_at = (
                    timezone.now()
                    if ticket_status == Ticket.Status.USED
                    else None
                )
                Ticket.objects.filter(
                    pk=self.upcoming_ticket.pk
                ).update(
                    status=ticket_status,
                    used_at=used_at,
                )

                response = self.client.get(
                    self.detail_url(self.upcoming_ticket)
                )

                self.assertEqual(
                    response.status_code,
                    status.HTTP_200_OK,
                )
                self.assertEqual(
                    response.json()["status"],
                    ticket_status,
                )
                self.assertEqual(
                    response.json()["is_checked_in"],
                    ticket_status == Ticket.Status.USED,
                )

    def test_ticket_detail_returns_owned_ticket(self):
        response = self.client.get(
            self.detail_url(self.upcoming_ticket)
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.json()["id"],
            str(self.upcoming_ticket.id),
        )
        self.assertEqual(
            response.json()["event_location_name"],
            self.venue.name,
        )

    def test_ticket_detail_for_another_owner_returns_404(self):
        response = self.client.get(
            self.detail_url(self.other_buyers_ticket)
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_ticket_event_status_filters_upcoming_and_past(self):
        upcoming_response = self.client.get(
            reverse("ticket-list"),
            {"event_status": "upcoming"},
        )
        past_response = self.client.get(
            reverse("ticket-list"),
            {"event_status": "past"},
        )

        self.assertEqual(
            upcoming_response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            past_response.status_code,
            status.HTTP_200_OK,
        )
        upcoming_ids = {
            item["id"]
            for item in upcoming_response.json()
        }
        past_ids = {
            item["id"]
            for item in past_response.json()
        }
        self.assertIn(str(self.upcoming_ticket.id), upcoming_ids)
        self.assertIn(str(self.foreign_event_ticket.id), upcoming_ids)
        self.assertEqual(
            past_ids,
            {str(self.past_ticket.id)},
        )

    def test_ticket_is_checked_in_filter(self):
        checked_in_at = timezone.now()
        Ticket.objects.filter(pk=self.upcoming_ticket.pk).update(
            status=Ticket.Status.USED,
            used_at=checked_in_at,
            checked_in_by=self.organizer,
        )

        checked_response = self.client.get(
            reverse("ticket-list"),
            {"is_checked_in": "true"},
        )
        unchecked_response = self.client.get(
            reverse("ticket-list"),
            {"is_checked_in": "false"},
        )

        self.assertEqual(
            {
                item["id"]
                for item in checked_response.json()
            },
            {str(self.upcoming_ticket.id)},
        )
        self.assertNotIn(
            str(self.upcoming_ticket.id),
            {
                item["id"]
                for item in unchecked_response.json()
            },
        )

    def test_invalid_ticket_filter_values_return_400(self):
        for query in [
            {"event_status": "current"},
            {"is_checked_in": "yes"},
        ]:
            with self.subTest(query=query):
                response = self.client.get(
                    reverse("ticket-list"),
                    query,
                )
                self.assertEqual(
                    response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )

    def test_check_in_requires_authentication(self):
        self.client.force_authenticate(user=None)

        response = self.client.post(
            self.check_in_url(self.upcoming_event),
            {"qr_code": str(self.upcoming_ticket.qr_code)},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_first_scan_checks_in_and_saves_audit_fields(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self.check_in_url(self.upcoming_event),
            {"qr_code": str(self.upcoming_ticket.qr_code)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response_data = response.json()
        self.assertEqual(response_data["result"], "checked_in")
        self.assertEqual(
            response_data["ticket_id"],
            str(self.upcoming_ticket.id),
        )
        self.upcoming_ticket.refresh_from_db()
        self.assertEqual(
            self.upcoming_ticket.status,
            Ticket.Status.USED,
        )
        self.assertIsNotNone(self.upcoming_ticket.used_at)
        self.assertEqual(
            self.upcoming_ticket.checked_in_by,
            self.organizer,
        )
        serialized = json.dumps(response_data, ensure_ascii=False)
        self.assertNotIn(self.buyer.email, serialized)
        self.assertNotIn(self.buyer.phone_number, serialized)

    def test_another_organizer_cannot_access_event_check_in(self):
        self.client.force_authenticate(user=self.other_organizer)

        response = self.client.post(
            self.check_in_url(self.upcoming_event),
            {"qr_code": str(self.upcoming_ticket.qr_code)},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.upcoming_ticket.refresh_from_db()
        self.assertIsNone(self.upcoming_ticket.used_at)

    def test_superadmin_can_check_in_ticket_for_any_event(self):
        self.client.force_authenticate(user=self.superadmin)

        response = self.client.post(
            self.check_in_url(self.upcoming_event),
            {"qr_code": str(self.upcoming_ticket.qr_code)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.upcoming_ticket.refresh_from_db()
        self.assertEqual(
            self.upcoming_ticket.checked_in_by,
            self.superadmin,
        )

    def test_empty_and_malformed_qr_codes_return_400(self):
        self.client.force_authenticate(user=self.organizer)

        for payload in [
            {},
            {"qr_code": ""},
            {"qr_code": "not-a-uuid"},
        ]:
            with self.subTest(payload=payload):
                response = self.client.post(
                    self.check_in_url(self.upcoming_event),
                    payload,
                    format="json",
                )
                self.assertEqual(
                    response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )

    def test_unknown_qr_code_returns_404(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self.check_in_url(self.upcoming_event),
            {"qr_code": str(uuid.uuid4())},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_qr_code_for_another_event_returns_404(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self.check_in_url(self.upcoming_event),
            {"qr_code": str(self.second_event_ticket.qr_code)},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_repeated_scan_returns_409_without_changing_time(self):
        self.client.force_authenticate(user=self.organizer)
        url = self.check_in_url(self.upcoming_event)
        payload = {"qr_code": str(self.upcoming_ticket.qr_code)}

        first_response = self.client.post(
            url,
            payload,
            format="json",
        )
        first_checked_in_at = self.upcoming_ticket.__class__.objects.get(
            pk=self.upcoming_ticket.pk
        ).used_at
        repeated_response = self.client.post(
            url,
            payload,
            format="json",
        )

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            repeated_response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(
            repeated_response.json()["result"],
            "already_checked_in",
        )
        self.upcoming_ticket.refresh_from_db()
        self.assertEqual(
            self.upcoming_ticket.used_at,
            first_checked_in_at,
        )
        self.assertEqual(
            repeated_response.json()["checked_in_at"],
            first_response.json()["checked_in_at"],
        )

    def test_non_paid_order_tickets_are_blocked(self):
        blocked_statuses = [
            Order.Status.PENDING,
            Order.Status.REFUNDED,
            Order.Status.CANCELLED,
            Order.Status.FAILED,
            Order.Status.EXPIRED,
        ]
        self.client.force_authenticate(user=self.organizer)

        for order_status in blocked_statuses:
            with self.subTest(order_status=order_status):
                ticket = self.create_ticket(
                    event=self.upcoming_event,
                    owner=self.buyer,
                    order_status=order_status,
                )
                response = self.client.post(
                    self.check_in_url(self.upcoming_event),
                    {"qr_code": str(ticket.qr_code)},
                    format="json",
                )
                self.assertEqual(
                    response.status_code,
                    status.HTTP_409_CONFLICT,
                )
                ticket.refresh_from_db()
                self.assertIsNone(ticket.used_at)
                self.assertIsNone(ticket.checked_in_by)

    def test_invalid_ticket_status_is_blocked(self):
        self.client.force_authenticate(user=self.organizer)

        for ticket_status in [
            Ticket.Status.CANCELLED,
            Ticket.Status.REFUNDED,
        ]:
            with self.subTest(ticket_status=ticket_status):
                ticket = self.create_ticket(
                    event=self.upcoming_event,
                    owner=self.buyer,
                    ticket_status=ticket_status,
                )
                response = self.client.post(
                    self.check_in_url(self.upcoming_event),
                    {"qr_code": str(ticket.qr_code)},
                    format="json",
                )
                self.assertEqual(
                    response.status_code,
                    status.HTTP_409_CONFLICT,
                )

    def test_check_in_list_is_event_scoped_newest_first_and_safe(self):
        self.client.force_authenticate(user=self.organizer)
        older_time = timezone.now() - timedelta(minutes=10)
        newer_time = timezone.now()
        second_ticket = self.create_ticket(
            event=self.upcoming_event,
            owner=self.buyer,
        )
        Ticket.objects.filter(pk=self.upcoming_ticket.pk).update(
            status=Ticket.Status.USED,
            used_at=older_time,
            checked_in_by=self.organizer,
        )
        Ticket.objects.filter(pk=second_ticket.pk).update(
            status=Ticket.Status.USED,
            used_at=newer_time,
            checked_in_by=self.organizer,
        )
        Ticket.objects.filter(pk=self.second_event_ticket.pk).update(
            status=Ticket.Status.USED,
            used_at=timezone.now(),
            checked_in_by=self.organizer,
        )

        response = self.client.get(
            self.check_in_url(self.upcoming_event)
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response_data = response.json()
        self.assertEqual(
            [item["ticket_id"] for item in response_data],
            [
                str(second_ticket.id),
                str(self.upcoming_ticket.id),
            ],
        )
        self.assertEqual(
            set(response_data[0]),
            {
                "ticket_id",
                "ticket_type_name",
                "attendee_display_name",
                "checked_in_at",
                "checked_in_by_display_name",
            },
        )
        serialized = json.dumps(response_data, ensure_ascii=False)
        self.assertNotIn(self.buyer.email, serialized)
        self.assertNotIn(self.buyer.phone_number, serialized)

    def test_another_organizer_cannot_view_check_in_list(self):
        self.client.force_authenticate(user=self.other_organizer)

        response = self.client.get(
            self.check_in_url(self.upcoming_event)
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )


class TicketCheckInConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.organizer = User.objects.create_user(
            email="concurrency-organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
            display_name="Concurrency Organizer",
        )
        self.buyer = User.objects.create_user(
            email="concurrency-buyer@hara.today",
            password="StrongPass123!",
            account_type="user",
            display_name="Concurrency Buyer",
        )
        category = Category.objects.create(
            name="Concurrency Check-in",
            slug="concurrency-check-in-category",
        )
        venue = Venue.objects.create(
            name="Concurrency Məkanı",
            city="Bakı",
            address="Concurrency ünvanı",
            location=Point(49.84, 40.37, srid=4326),
        )
        now = timezone.now()
        self.event = Event.objects.create(
            organizer=self.organizer,
            category=category,
            venue=venue,
            title="Concurrency Check-in Event",
            description="Parallel scan test event",
            start_at=now + timedelta(days=1),
            end_at=now + timedelta(days=1, hours=2),
            status=Event.Status.PUBLISHED,
        )
        ticket_type = TicketType.objects.create(
            event=self.event,
            name="Concurrency Ticket",
            price=Decimal("10.00"),
            capacity=10,
        )
        order = Order.objects.create(
            buyer=self.buyer,
            status=Order.Status.PAID,
            total_amount=Decimal("10.00"),
            paid_at=timezone.now(),
        )
        order_item = OrderItem.objects.create(
            order=order,
            ticket_type=ticket_type,
            quantity=1,
            unit_price=Decimal("10.00"),
        )
        self.ticket = Ticket.objects.create(
            order_item=order_item,
            event=self.event,
            owner=self.buyer,
        )

    def test_parallel_scans_have_only_one_successful_transition(self):
        barrier = Barrier(2)
        results = []
        errors = []

        def scan():
            close_old_connections()

            try:
                event = Event.objects.get(pk=self.event.pk)
                organizer = User.objects.get(pk=self.organizer.pk)
                barrier.wait()
                result = check_in_ticket(
                    event=event,
                    qr_code=self.ticket.qr_code,
                    organizer=organizer,
                )
                results.append(result.already_checked_in)
            except Exception as exc:
                errors.append(exc)
            finally:
                close_old_connections()

        threads = [Thread(target=scan), Thread(target=scan)]

        for thread in threads:
            thread.start()

        for thread in threads:
            thread.join(timeout=10)

        self.assertFalse(errors)
        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.assertCountEqual(results, [False, True])
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status, Ticket.Status.USED)
        self.assertIsNotNone(self.ticket.used_at)
        self.assertEqual(
            self.ticket.checked_in_by,
            self.organizer,
        )


class InventoryReservationAndExpirationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = User.objects.create_user(
            email="inventory-organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
            display_name="Inventory Organizer",
        )
        cls.buyer = User.objects.create_user(
            email="inventory-buyer@hara.today",
            password="StrongPass123!",
            account_type="user",
            display_name="Inventory Buyer",
        )
        cls.other_buyer = User.objects.create_user(
            email="inventory-other@hara.today",
            password="StrongPass123!",
            account_type="user",
            display_name="Other Inventory Buyer",
        )
        cls.category = Category.objects.create(
            name="Inventory",
            slug="inventory-category",
        )
        cls.venue = Venue.objects.create(
            name="Inventory Məkanı",
            city="Bakı",
            address="Inventory ünvanı",
            location=Point(49.84, 40.37, srid=4326),
        )
        now = timezone.now()
        cls.event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Inventory Event",
            description="Inventory test event",
            start_at=now + timedelta(days=20),
            end_at=now + timedelta(days=20, hours=2),
            status=Event.Status.PUBLISHED,
        )
        cls.ticket_type = TicketType.objects.create(
            event=cls.event,
            name="Inventory Standard",
            price=Decimal("12.50"),
            capacity=10,
            max_per_order=10,
            sales_start_at=now - timedelta(days=1),
            sales_end_at=now + timedelta(days=10),
            is_active=True,
        )
        cls.second_ticket_type = TicketType.objects.create(
            event=cls.event,
            name="Inventory VIP",
            price=Decimal("25.00"),
            capacity=5,
            max_per_order=5,
            sales_start_at=now - timedelta(days=1),
            sales_end_at=now + timedelta(days=10),
            is_active=True,
        )

    def setUp(self):
        self.client.force_authenticate(user=self.buyer)
        self.order_url = reverse("order-create")

    def create_order_item(
        self,
        *,
        ticket_type=None,
        buyer=None,
        quantity=1,
        order_status=Order.Status.PENDING,
        expires_at=None,
    ):
        ticket_type = ticket_type or self.ticket_type
        buyer = buyer or self.buyer
        order = Order.objects.create(
            buyer=buyer,
            status=order_status,
            total_amount=ticket_type.price * quantity,
            expires_at=expires_at,
            paid_at=(
                timezone.now()
                if order_status == Order.Status.PAID
                else None
            ),
        )
        order_item = OrderItem.objects.create(
            order=order,
            ticket_type=ticket_type,
            quantity=quantity,
            unit_price=ticket_type.price,
        )
        return order, order_item

    def order_payload(self, *, quantity=1, ticket_type=None):
        ticket_type = ticket_type or self.ticket_type
        return {
            "items": [
                {
                    "ticket_type_id": ticket_type.id,
                    "quantity": quantity,
                }
            ]
        }

    def test_inventory_uses_only_paid_and_active_pending_quantities(self):
        now = timezone.now()
        self.create_order_item(
            quantity=2,
            expires_at=now + timedelta(minutes=5),
        )
        self.create_order_item(
            quantity=3,
            expires_at=now - timedelta(seconds=1),
        )
        self.create_order_item(
            quantity=4,
            order_status=Order.Status.PAID,
        )

        for order_status in [
            Order.Status.FAILED,
            Order.Status.CANCELLED,
            Order.Status.EXPIRED,
        ]:
            self.create_order_item(
                quantity=1,
                order_status=order_status,
                expires_at=now + timedelta(minutes=5),
            )

        snapshot = get_inventory_snapshot(
            self.ticket_type,
            now=now,
        )

        self.assertEqual(snapshot.capacity, 10)
        self.assertEqual(snapshot.reserved_quantity, 2)
        self.assertEqual(snapshot.sold_quantity, 4)
        self.assertEqual(snapshot.available_quantity, 4)

    def test_available_quantity_is_never_negative(self):
        self.create_order_item(
            quantity=11,
            order_status=Order.Status.PAID,
        )

        snapshot = get_inventory_snapshot(self.ticket_type)

        self.assertEqual(snapshot.sold_quantity, 11)
        self.assertEqual(snapshot.available_quantity, 0)

    def test_ticket_type_response_exposes_current_availability(self):
        now = timezone.now()
        self.create_order_item(
            quantity=2,
            expires_at=now + timedelta(minutes=5),
        )
        self.create_order_item(
            quantity=3,
            order_status=Order.Status.PAID,
        )
        self.create_order_item(
            quantity=4,
            expires_at=now - timedelta(seconds=1),
        )
        self.client.force_authenticate(user=self.organizer)
        url = reverse(
            "organizer-ticket-type-list",
            kwargs={"event_slug": self.event.slug},
        )

        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ticket_data = next(
            item
            for item in response.json()
            if item["id"] == self.ticket_type.id
        )
        self.assertEqual(ticket_data["capacity"], 10)
        self.assertEqual(ticket_data["available_quantity"], 5)
        self.assertTrue(ticket_data["is_available"])
        self.assertIn("sales_start_at", ticket_data)
        self.assertIn("sales_end_at", ticket_data)

    @override_settings(ORDER_RESERVATION_MINUTES=7)
    def test_order_uses_server_price_and_configured_expiration(self):
        before = timezone.now()
        payload = self.order_payload(quantity=2)
        payload.update(
            {
                "total_amount": "0.01",
                "price": "0.01",
                "expires_at": (
                    before + timedelta(days=30)
                ).isoformat(),
            }
        )

        response = self.client.post(
            self.order_url,
            payload,
            format="json",
        )
        after = timezone.now()

        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED,
        )
        order = Order.objects.get(pk=response.json()["id"])
        self.assertEqual(order.total_amount, Decimal("25.00"))
        self.assertGreaterEqual(
            order.expires_at,
            before + timedelta(minutes=7),
        )
        self.assertLessEqual(
            order.expires_at,
            after + timedelta(minutes=7),
        )
        self.assertNotEqual(
            order.expires_at.isoformat(),
            payload["expires_at"],
        )

    def test_quantity_must_be_a_positive_json_integer(self):
        for invalid_quantity in [
            0,
            -1,
            True,
            1.5,
            "1",
            None,
        ]:
            with self.subTest(quantity=invalid_quantity):
                response = self.client.post(
                    self.order_url,
                    self.order_payload(
                        quantity=invalid_quantity
                    ),
                    format="json",
                )
                self.assertEqual(
                    response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )

        self.assertEqual(Order.objects.count(), 0)

    def test_insufficient_capacity_has_machine_readable_error(self):
        self.create_order_item(
            quantity=9,
            order_status=Order.Status.PAID,
        )

        response = self.client.post(
            self.order_url,
            self.order_payload(quantity=2),
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(
            response.json()["code"],
            "INSUFFICIENT_CAPACITY",
        )
        self.assertEqual(
            response.json()["ticket_type_id"],
            self.ticket_type.id,
        )
        self.assertEqual(
            response.json()["requested_quantity"],
            2,
        )
        self.assertEqual(
            response.json()["available_quantity"],
            1,
        )

    def test_failed_multi_item_order_has_no_partial_reservation(self):
        self.create_order_item(
            ticket_type=self.second_ticket_type,
            quantity=5,
            order_status=Order.Status.PAID,
        )
        initial_order_count = Order.objects.count()
        payload = {
            "items": [
                {
                    "ticket_type_id": self.ticket_type.id,
                    "quantity": 2,
                },
                {
                    "ticket_type_id": self.second_ticket_type.id,
                    "quantity": 1,
                },
            ]
        }

        response = self.client.post(
            self.order_url,
            payload,
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(
            response.json()["code"],
            "INSUFFICIENT_CAPACITY",
        )
        self.assertEqual(Order.objects.count(), initial_order_count)
        snapshot = get_inventory_snapshot(self.ticket_type)
        self.assertEqual(snapshot.reserved_quantity, 0)

    def test_same_idempotency_key_replays_same_order_once(self):
        payload = self.order_payload(quantity=2)

        first_response = self.client.post(
            self.order_url,
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="same-order-key",
        )
        repeated_response = self.client.post(
            self.order_url,
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="same-order-key",
        )

        self.assertEqual(
            first_response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            repeated_response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            first_response.json()["id"],
            repeated_response.json()["id"],
        )
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(OrderItem.objects.count(), 1)
        self.assertEqual(OrderIdempotencyKey.objects.count(), 1)
        snapshot = get_inventory_snapshot(self.ticket_type)
        self.assertEqual(snapshot.reserved_quantity, 2)

    def test_same_idempotency_key_with_new_payload_returns_409(self):
        first_response = self.client.post(
            self.order_url,
            self.order_payload(quantity=1),
            format="json",
            HTTP_IDEMPOTENCY_KEY="reused-order-key",
        )
        conflict_response = self.client.post(
            self.order_url,
            self.order_payload(quantity=2),
            format="json",
            HTTP_IDEMPOTENCY_KEY="reused-order-key",
        )

        self.assertEqual(
            first_response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            conflict_response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(
            conflict_response.json()["code"],
            "IDEMPOTENCY_KEY_REUSED",
        )
        self.assertEqual(Order.objects.count(), 1)

    def test_different_users_can_use_same_idempotency_key(self):
        first_response = self.client.post(
            self.order_url,
            self.order_payload(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="shared-text-key",
        )
        self.client.force_authenticate(user=self.other_buyer)
        second_response = self.client.post(
            self.order_url,
            self.order_payload(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="shared-text-key",
        )

        self.assertEqual(
            first_response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            second_response.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(Order.objects.count(), 2)
        self.assertEqual(OrderIdempotencyKey.objects.count(), 2)

    def test_expiration_service_obeys_boundary_and_terminal_statuses(self):
        boundary = timezone.now()
        due_order, _ = self.create_order_item(
            expires_at=boundary,
        )
        future_order, _ = self.create_order_item(
            expires_at=boundary + timedelta(seconds=1),
        )
        terminal_orders = []

        for order_status in [
            Order.Status.PAID,
            Order.Status.FAILED,
            Order.Status.CANCELLED,
            Order.Status.REFUNDED,
            Order.Status.EXPIRED,
        ]:
            order, _ = self.create_order_item(
                order_status=order_status,
                expires_at=boundary - timedelta(seconds=1),
            )
            terminal_orders.append(order)

        result = expire_pending_orders(
            now=boundary,
            batch_size=1,
        )

        self.assertEqual(result.checked, 1)
        self.assertEqual(result.expired, 1)
        self.assertEqual(result.skipped, 0)
        due_order.refresh_from_db()
        future_order.refresh_from_db()
        self.assertEqual(due_order.status, Order.Status.EXPIRED)
        self.assertEqual(future_order.status, Order.Status.PENDING)

        for order in terminal_orders:
            original_status = order.status
            order.refresh_from_db()
            self.assertEqual(order.status, original_status)

        repeated_result = expire_pending_orders(
            now=boundary,
            batch_size=1,
        )
        self.assertEqual(repeated_result.expired, 0)

    def test_expiration_preserves_financial_and_ticket_records(self):
        boundary = timezone.now()
        order, order_item = self.create_order_item(
            expires_at=boundary,
        )
        payment = Payment.objects.create(
            order=order,
            status=Payment.Status.INITIATED,
            amount=order.total_amount,
            currency=order.currency,
            provider="sandbox",
            provider_reference=f"preserve-{uuid.uuid4().hex}",
        )
        ticket = Ticket.objects.create(
            order_item=order_item,
            event=self.event,
            owner=self.buyer,
        )

        result = expire_pending_orders(now=boundary)

        self.assertEqual(result.expired, 1)
        self.assertTrue(
            Payment.objects.filter(pk=payment.pk).exists()
        )
        self.assertTrue(
            Ticket.objects.filter(pk=ticket.pk).exists()
        )

    def test_expiration_releases_inventory_and_command_is_idempotent(self):
        before_expiry = timezone.now()
        order, _ = self.create_order_item(
            quantity=3,
            expires_at=before_expiry + timedelta(seconds=1),
        )
        reserved_snapshot = get_inventory_snapshot(
            self.ticket_type,
            now=before_expiry,
        )
        command_time = before_expiry + timedelta(seconds=2)

        result = expire_pending_orders(now=command_time)

        self.assertEqual(reserved_snapshot.reserved_quantity, 3)
        self.assertEqual(result.expired, 1)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.EXPIRED)
        available_snapshot = get_inventory_snapshot(
            self.ticket_type,
            now=command_time,
        )
        self.assertEqual(available_snapshot.reserved_quantity, 0)
        self.assertEqual(available_snapshot.available_quantity, 10)

        due_order, _ = self.create_order_item(
            expires_at=timezone.now() - timedelta(seconds=1),
        )
        first_output = StringIO()
        second_output = StringIO()
        call_command(
            "expire_orders",
            batch_size=1,
            stdout=first_output,
        )
        call_command(
            "expire_orders",
            batch_size=1,
            stdout=second_output,
        )
        due_order.refresh_from_db()
        self.assertEqual(due_order.status, Order.Status.EXPIRED)
        self.assertIn("expired 1", first_output.getvalue())
        self.assertIn("expired 0", second_output.getvalue())

    def test_capacity_cannot_drop_below_active_reservation(self):
        self.ticket_type.max_per_order = 1
        self.ticket_type.save(update_fields=["max_per_order"])
        self.create_order_item(
            quantity=2,
            expires_at=timezone.now() + timedelta(minutes=5),
        )
        self.client.force_authenticate(user=self.organizer)
        url = reverse(
            "organizer-ticket-type-detail",
            kwargs={
                "event_slug": self.event.slug,
                "pk": self.ticket_type.pk,
            },
        )

        conflict_response = self.client.patch(
            url,
            {"capacity": 1},
            format="json",
        )
        accepted_response = self.client.patch(
            url,
            {"capacity": 2},
            format="json",
        )

        self.assertEqual(
            conflict_response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(
            conflict_response.json()["code"],
            "CAPACITY_BELOW_COMMITTED",
        )
        self.assertEqual(
            accepted_response.status_code,
            status.HTTP_200_OK,
        )


class InventoryConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.organizer = User.objects.create_user(
            email="last-seat-organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
        )
        self.first_buyer = User.objects.create_user(
            email="last-seat-first@hara.today",
            password="StrongPass123!",
            account_type="user",
        )
        self.second_buyer = User.objects.create_user(
            email="last-seat-second@hara.today",
            password="StrongPass123!",
            account_type="user",
        )
        category = Category.objects.create(
            name="Last Seat",
            slug="last-seat-category",
        )
        venue = Venue.objects.create(
            name="Last Seat Məkanı",
            city="Bakı",
            address="Last seat ünvanı",
            location=Point(49.84, 40.37, srid=4326),
        )
        now = timezone.now()
        self.event = Event.objects.create(
            organizer=self.organizer,
            category=category,
            venue=venue,
            title="Last Seat Event",
            description="Last seat concurrency event",
            start_at=now + timedelta(days=2),
            end_at=now + timedelta(days=2, hours=2),
            status=Event.Status.PUBLISHED,
        )
        self.ticket_type = TicketType.objects.create(
            event=self.event,
            name="Last Seat Standard",
            price=Decimal("10.00"),
            capacity=1,
            max_per_order=1,
            sales_start_at=now - timedelta(days=1),
            sales_end_at=now + timedelta(days=1),
        )
        self.other_ticket_type = TicketType.objects.create(
            event=self.event,
            name="Independent Seat",
            price=Decimal("20.00"),
            capacity=1,
            max_per_order=1,
            sales_start_at=now - timedelta(days=1),
            sales_end_at=now + timedelta(days=1),
        )
        self.order_url = reverse("order-create")

    def run_parallel_requests(self, requests):
        barrier = Barrier(len(requests))
        results = []
        errors = []

        def request_order(user_id, ticket_type_id, key):
            close_old_connections()

            try:
                user = User.objects.get(pk=user_id)
                client = APIClient()
                client.force_authenticate(user=user)
                barrier.wait()
                response = client.post(
                    self.order_url,
                    {
                        "items": [
                            {
                                "ticket_type_id": ticket_type_id,
                                "quantity": 1,
                            }
                        ]
                    },
                    format="json",
                    HTTP_IDEMPOTENCY_KEY=key,
                )
                results.append(
                    (response.status_code, response.json())
                )
            except Exception as exc:
                errors.append(exc)
            finally:
                close_old_connections()

        threads = [
            Thread(
                target=request_order,
                args=request_args,
            )
            for request_args in requests
        ]

        for thread in threads:
            thread.start()

        for thread in threads:
            thread.join(timeout=10)

        self.assertFalse(errors)
        self.assertFalse(any(thread.is_alive() for thread in threads))
        return results

    def test_last_seat_allows_only_one_parallel_checkout(self):
        results = self.run_parallel_requests(
            [
                (
                    self.first_buyer.pk,
                    self.ticket_type.pk,
                    "last-seat-first-key",
                ),
                (
                    self.second_buyer.pk,
                    self.ticket_type.pk,
                    "last-seat-second-key",
                ),
            ]
        )

        self.assertEqual(
            sorted(result[0] for result in results),
            [
                status.HTTP_201_CREATED,
                status.HTTP_409_CONFLICT,
            ],
        )
        conflict_data = next(
            data
            for response_status, data in results
            if response_status == status.HTTP_409_CONFLICT
        )
        self.assertEqual(
            conflict_data["code"],
            "INSUFFICIENT_CAPACITY",
        )
        snapshot = get_inventory_snapshot(self.ticket_type)
        self.assertEqual(
            snapshot.reserved_quantity + snapshot.sold_quantity,
            1,
        )

    def test_parallel_duplicate_key_creates_only_one_order(self):
        results = self.run_parallel_requests(
            [
                (
                    self.first_buyer.pk,
                    self.ticket_type.pk,
                    "parallel-duplicate-key",
                ),
                (
                    self.first_buyer.pk,
                    self.ticket_type.pk,
                    "parallel-duplicate-key",
                ),
            ]
        )

        self.assertEqual(
            sorted(result[0] for result in results),
            [
                status.HTTP_200_OK,
                status.HTTP_201_CREATED,
            ],
        )
        self.assertEqual(
            len({data["id"] for _, data in results}),
            1,
        )
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(OrderItem.objects.count(), 1)
        self.assertEqual(OrderIdempotencyKey.objects.count(), 1)
        snapshot = get_inventory_snapshot(self.ticket_type)
        self.assertEqual(snapshot.reserved_quantity, 1)

    def test_independent_ticket_types_can_checkout_in_parallel(self):
        results = self.run_parallel_requests(
            [
                (
                    self.first_buyer.pk,
                    self.ticket_type.pk,
                    "independent-first-key",
                ),
                (
                    self.second_buyer.pk,
                    self.other_ticket_type.pk,
                    "independent-second-key",
                ),
            ]
        )

        self.assertEqual(
            [result[0] for result in results].count(
                status.HTTP_201_CREATED
            ),
            2,
        )
        self.assertEqual(Order.objects.count(), 2)

    def test_parallel_expiration_workers_process_order_once(self):
        order = Order.objects.create(
            buyer=self.first_buyer,
            status=Order.Status.PENDING,
            total_amount=Decimal("10.00"),
            expires_at=timezone.now() - timedelta(seconds=1),
        )
        OrderItem.objects.create(
            order=order,
            ticket_type=self.ticket_type,
            quantity=1,
            unit_price=self.ticket_type.price,
        )
        barrier = Barrier(2)
        results = []
        errors = []

        def expire():
            close_old_connections()

            try:
                barrier.wait()
                result = expire_pending_orders(batch_size=1)
                results.append(result.expired)
            except Exception as exc:
                errors.append(exc)
            finally:
                close_old_connections()

        threads = [Thread(target=expire), Thread(target=expire)]

        for thread in threads:
            thread.start()

        for thread in threads:
            thread.join(timeout=10)

        self.assertFalse(errors)
        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.assertEqual(sum(results), 1)
        order.refresh_from_db()
        self.assertEqual(order.status, Order.Status.EXPIRED)


class VenueSectionTicketTypeAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = User.objects.create_user(
            email="section-price-organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
        )
        cls.category = Category.objects.create(
            name="Section price music",
            slug="section-price-music",
        )
        cls.venue = Venue.objects.create(
            name="Section Price Hall",
            city="Bakı",
            address="Neftçilər prospekti 1",
            location=Point(49.84, 40.37, srid=4326),
            created_by=cls.organizer,
        )
        cls.plan = VenuePlan.objects.create(
            venue=cls.venue,
            name="Main hall",
            version=1,
            status=VenuePlan.Status.PUBLISHED,
            is_default=True,
        )
        cls.section = VenueSection.objects.create(
            venue_plan=cls.plan,
            code="VIP",
            name="VIP zona",
            seating_type=VenueSection.SeatingType.GENERAL_ADMISSION,
            color="#5B5CE2",
            capacity=20,
        )
        start_at = timezone.now() + timedelta(days=10)
        cls.event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            venue_plan=cls.plan,
            title="Zone price event",
            description="Section price test",
            start_at=start_at,
            end_at=start_at + timedelta(hours=2),
            status=Event.Status.PUBLISHED,
        )

    def setUp(self):
        self.client.force_authenticate(user=self.organizer)

    def test_organizer_assigns_event_price_to_venue_section(self):
        response = self.client.post(
            reverse(
                "organizer-ticket-type-list",
                kwargs={"event_slug": self.event.slug},
            ),
            {
                "name": "VIP",
                "venue_section_id": str(self.section.id),
                "price": "45.00",
                "capacity": 20,
                "max_per_order": 4,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            response.json()["venue_section_id"],
            str(self.section.id),
        )
        self.assertEqual(response.json()["venue_section"]["code"], "VIP")

    def test_ticket_capacity_cannot_exceed_section_capacity(self):
        response = self.client.post(
            reverse(
                "organizer-ticket-type-list",
                kwargs={"event_slug": self.event.slug},
            ),
            {
                "name": "VIP",
                "venue_section_id": str(self.section.id),
                "price": "45.00",
                "capacity": 21,
                "max_per_order": 4,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("capacity", response.json())

    def test_section_from_another_plan_is_rejected(self):
        other_plan = VenuePlan.objects.create(
            venue=self.venue,
            name="Alternative hall",
            version=2,
            status=VenuePlan.Status.PUBLISHED,
        )
        other_section = VenueSection.objects.create(
            venue_plan=other_plan,
            code="ALT",
            name="Alternative zona",
            capacity=10,
        )

        response = self.client.post(
            reverse(
                "organizer-ticket-type-list",
                kwargs={"event_slug": self.event.slug},
            ),
            {
                "name": "Alternative",
                "venue_section_id": str(other_section.id),
                "price": "20.00",
                "capacity": 10,
                "max_per_order": 2,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("venue_section_id", response.json())
