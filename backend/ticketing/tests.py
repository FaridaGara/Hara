import hashlib
import hmac
import json
import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.db import IntegrityError, transaction
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from events.models import Category, Event, Venue

from .models import (
    Order,
    OrderItem,
    Payment,
    PaymentWebhookEvent,
    Ticket,
    TicketType,
)


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
            account_type="attendee",
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
            account_type="attendee",
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
            account_type="attendee",
        )
        cls.other_buyer = User.objects.create_user(
            email="lifecycle-other-buyer@hara.today",
            password="StrongPass123!",
            account_type="attendee",
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
            account_type="attendee",
        )
        cls.other_buyer = User.objects.create_user(
            email="payment-other-buyer@hara.today",
            password="StrongPass123!",
            account_type="attendee",
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
