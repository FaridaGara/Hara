import uuid
from datetime import datetime, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from ticketing.models import Order, OrderItem, Ticket, TicketType

from .models import Category, Event, Favorite, Venue


class FavoriteAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = get_user_model().objects.create_user(
            email="favorite-organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
        )
        cls.user = get_user_model().objects.create_user(
            email="favorite-user@hara.today",
            password="StrongPass123!",
            account_type="attendee",
        )
        cls.other_user = get_user_model().objects.create_user(
            email="favorite-other@hara.today",
            password="StrongPass123!",
            account_type="attendee",
        )
        cls.category = Category.objects.create(
            name="Favorite Music",
            slug="favorite-music",
        )
        cls.venue = Venue.objects.create(
            name="Favorite Venue",
            city="Bakı",
            address="Favorite test ünvanı",
            location=Point(49.84, 40.37, srid=4326),
        )
        start_at = timezone.now() + timedelta(days=7)
        cls.published_event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Sevimli yayımlanmış tədbir",
            description="Favorite API testi",
            start_at=start_at,
            end_at=start_at + timedelta(hours=2),
            status=Event.Status.PUBLISHED,
        )
        cls.draft_event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Sevimli draft tədbir",
            description="Favorite API-də seçilə bilməz",
            start_at=start_at,
            end_at=start_at + timedelta(hours=2),
            status=Event.Status.DRAFT,
        )

    def setUp(self):
        self.list_url = reverse("favorite-list")
        self.detail_url = reverse(
            "favorite-detail",
            kwargs={"event_id": self.published_event.id},
        )

    def test_favorite_endpoints_require_authentication(self):
        responses = [
            self.client.get(self.list_url),
            self.client.post(
                self.list_url,
                {"event_id": str(self.published_event.id)},
                format="json",
            ),
            self.client.delete(self.detail_url),
        ]

        for response in responses:
            self.assertEqual(
                response.status_code,
                status.HTTP_401_UNAUTHORIZED,
            )

    def test_user_can_add_list_and_remove_own_favorite(self):
        self.client.force_authenticate(user=self.user)

        created = self.client.post(
            self.list_url,
            {"event_id": str(self.published_event.id)},
            format="json",
        )
        duplicate = self.client.post(
            self.list_url,
            {"event_id": str(self.published_event.id)},
            format="json",
        )
        listed = self.client.get(self.list_url)

        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertEqual(duplicate.status_code, status.HTTP_200_OK)
        self.assertEqual(Favorite.objects.filter(user=self.user).count(), 1)
        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [event["id"] for event in listed.json()],
            [str(self.published_event.id)],
        )

        deleted = self.client.delete(self.detail_url)
        deleted_again = self.client.delete(self.detail_url)

        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(
            deleted_again.status_code,
            status.HTTP_204_NO_CONTENT,
        )
        self.assertFalse(Favorite.objects.filter(user=self.user).exists())

    def test_favorites_are_scoped_to_authenticated_user(self):
        Favorite.objects.create(
            user=self.other_user,
            event=self.published_event,
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.get(self.list_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json(), [])

    def test_draft_event_cannot_be_favorited(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.post(
            self.list_url,
            {"event_id": str(self.draft_event.id)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(Favorite.objects.filter(user=self.user).exists())


class EventAPITests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = get_user_model().objects.create_user(
            email="organizer@hara.today",
            password="TestPassword123!",
            account_type="organizer",
        )

        cls.category = Category.objects.create(
            name="Musiqi",
            slug="musiqi",
        )

        cls.venue = Venue.objects.create(
            name="Heydər Əliyev Sarayı",
            city="Bakı",
            address="Bülbül prospekti 35",
            location=Point(49.8415, 40.3777, srid=4326),
        )

        start_at = timezone.now() + timedelta(days=7)

        cls.published_event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="HARA Musiqi Tədbiri",
            description="Yayımlanmış test tədbiri",
            start_at=start_at,
            end_at=start_at + timedelta(hours=2),
            status=Event.Status.PUBLISHED,
            is_featured=True,
        )

        cls.draft_event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Gizli Draft Tədbiri",
            description="API-də görünməməlidir",
            start_at=start_at,
            end_at=start_at + timedelta(hours=1),
            status=Event.Status.DRAFT,
        )

    def test_event_list_returns_only_published_events(self):
        response = self.client.get(reverse("events:event-list"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)
        self.assertEqual(
            response.json()[0]["title"],
            self.published_event.title,
        )

    def test_event_detail_returns_published_event(self):
        response = self.client.get(
            reverse(
                "events:event-detail",
                kwargs={"slug": self.published_event.slug},
            )
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], str(self.published_event.id))

    def test_draft_event_detail_returns_404(self):
        response = self.client.get(
            reverse(
                "events:event-detail",
                kwargs={"slug": self.draft_event.slug},
            )
        )

        self.assertEqual(response.status_code, 404)

    def test_event_search(self):
        response = self.client.get(
            reverse("events:event-list"),
            {"search": "Musiqi"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)

    def test_category_filter(self):
        response = self.client.get(
            reverse("events:event-list"),
            {"category": "musiqi"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)

    def test_city_and_featured_filters(self):
        response = self.client.get(
            reverse("events:event-list"),
            {
                "city": "Bakı",
                "featured": "true",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)
        self.assertTrue(response.json()[0]["is_featured"])


class PublicEventTicketTypeContractTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = get_user_model().objects.create_user(
            email="public-contract-organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
        )
        cls.buyer = get_user_model().objects.create_user(
            email="public-contract-buyer@hara.today",
            password="StrongPass123!",
            account_type="attendee",
        )
        cls.category = Category.objects.create(
            name="Public Contract",
            slug="public-contract",
        )
        cls.venue = Venue.objects.create(
            name="Public Contract Məkanı",
            city="Bakı",
            address="Public contract ünvanı",
            location=Point(49.84, 40.37, srid=4326),
        )
        now = timezone.now()
        cls.event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Public Purchasing Event",
            description="Attendee purchasing contract",
            start_at=now + timedelta(days=20),
            end_at=now + timedelta(days=20, hours=2),
            status=Event.Status.PUBLISHED,
        )
        cls.ticket_type = TicketType.objects.create(
            event=cls.event,
            name="Standard",
            price=Decimal("20.00"),
            capacity=10,
            max_per_order=4,
            sales_start_at=now - timedelta(days=1),
            sales_end_at=now + timedelta(days=10),
            is_active=True,
        )
        cls.draft_event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Draft Purchasing Event",
            description="Public görünməməlidir",
            start_at=now + timedelta(days=20),
            end_at=now + timedelta(days=20, hours=2),
            status=Event.Status.DRAFT,
        )
        cls.draft_ticket_type = TicketType.objects.create(
            event=cls.draft_event,
            name="Draft Standard",
            price=Decimal("15.00"),
            capacity=10,
            max_per_order=2,
            is_active=True,
        )

    def detail_url(self, event=None):
        return reverse(
            "events:event-detail",
            kwargs={"slug": (event or self.event).slug},
        )

    def create_order_item(
        self,
        *,
        quantity,
        status=Order.Status.PENDING,
        expires_at=None,
        ticket_type=None,
    ):
        ticket_type = ticket_type or self.ticket_type
        order = Order.objects.create(
            buyer=self.buyer,
            status=status,
            total_amount=ticket_type.price * quantity,
            currency="AZN",
            expires_at=expires_at,
            paid_at=(
                timezone.now()
                if status == Order.Status.PAID
                else None
            ),
        )
        OrderItem.objects.create(
            order=order,
            ticket_type=ticket_type,
            quantity=quantity,
            unit_price=ticket_type.price,
        )
        return order

    def public_ticket_data(self):
        response = self.client.get(self.detail_url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return next(
            item
            for item in response.json()["ticket_types"]
            if item["id"] == self.ticket_type.id
        )

    def test_public_detail_returns_safe_ticket_type_contract(self):
        inactive = TicketType.objects.create(
            event=self.event,
            name="Inactive",
            price=Decimal("99.00"),
            capacity=3,
            max_per_order=1,
            is_active=False,
        )

        response = self.client.get(self.detail_url())

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        response_data = response.json()
        uuid.UUID(response_data["id"])
        ticket_types = response_data["ticket_types"]
        self.assertEqual(
            [item["id"] for item in ticket_types],
            [self.ticket_type.id],
        )
        self.assertNotIn(
            inactive.id,
            {item["id"] for item in ticket_types},
        )
        ticket_data = ticket_types[0]
        self.assertEqual(
            set(ticket_data),
            {
                "id",
                "name",
                "price",
                "currency",
                "available_quantity",
                "sales_start_at",
                "sales_end_at",
                "min_quantity",
                "max_quantity",
                "sales_status",
                "is_available",
            },
        )
        self.assertIsInstance(ticket_data["price"], str)
        self.assertEqual(ticket_data["price"], "20.00")
        self.assertEqual(ticket_data["currency"], "AZN")
        self.assertEqual(ticket_data["min_quantity"], 1)
        self.assertEqual(ticket_data["max_quantity"], 4)
        self.assertEqual(ticket_data["sales_status"], "AVAILABLE")
        self.assertTrue(ticket_data["is_available"])

        for field in ["sales_start_at", "sales_end_at"]:
            parsed = datetime.fromisoformat(
                ticket_data[field].replace("Z", "+00:00")
            )
            self.assertTrue(timezone.is_aware(parsed))

        serialized = str(ticket_data)
        for organizer_only_field in [
            "capacity",
            "max_per_order",
            "is_active",
            "created_at",
            "updated_at",
            "reserved_quantity",
            "sold_quantity",
        ]:
            self.assertNotIn(organizer_only_field, serialized)

    def test_draft_event_and_its_ticket_types_are_not_public(self):
        response = self.client.get(
            self.detail_url(self.draft_event)
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )
        serialized = str(response.json())
        self.assertNotIn(self.draft_ticket_type.name, serialized)

    def test_sales_status_upcoming_boundary(self):
        self.ticket_type.sales_start_at = (
            timezone.now() + timedelta(hours=1)
        )
        self.ticket_type.save(update_fields=["sales_start_at"])

        ticket_data = self.public_ticket_data()

        self.assertEqual(ticket_data["sales_status"], "UPCOMING")
        self.assertFalse(ticket_data["is_available"])

    def test_sales_status_available(self):
        ticket_data = self.public_ticket_data()

        self.assertEqual(ticket_data["sales_status"], "AVAILABLE")
        self.assertTrue(ticket_data["is_available"])

    def test_sales_status_sold_out(self):
        self.create_order_item(
            quantity=self.ticket_type.capacity,
            status=Order.Status.PAID,
        )

        ticket_data = self.public_ticket_data()

        self.assertEqual(ticket_data["available_quantity"], 0)
        self.assertEqual(ticket_data["max_quantity"], 0)
        self.assertEqual(ticket_data["sales_status"], "SOLD_OUT")
        self.assertFalse(ticket_data["is_available"])

    def test_sales_status_ended_boundary(self):
        self.ticket_type.sales_end_at = timezone.now()
        self.ticket_type.save(update_fields=["sales_end_at"])

        ticket_data = self.public_ticket_data()

        self.assertEqual(ticket_data["sales_status"], "ENDED")
        self.assertFalse(ticket_data["is_available"])

    def test_availability_reuses_active_reservation_and_paid_rules(self):
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
            status=Order.Status.PAID,
        )

        ticket_data = self.public_ticket_data()

        self.assertEqual(ticket_data["available_quantity"], 4)
        self.assertEqual(ticket_data["max_quantity"], 4)

    def test_availability_is_never_negative(self):
        self.create_order_item(
            quantity=self.ticket_type.capacity + 1,
            status=Order.Status.PAID,
        )

        ticket_data = self.public_ticket_data()

        self.assertEqual(ticket_data["available_quantity"], 0)
        self.assertEqual(ticket_data["sales_status"], "SOLD_OUT")

    def test_public_ticket_type_id_creates_server_priced_order(self):
        ticket_data = self.public_ticket_data()
        self.client.force_authenticate(user=self.buyer)

        response = self.client.post(
            reverse("order-create"),
            {
                "items": [
                    {
                        "ticket_type_id": ticket_data["id"],
                        "quantity": 2,
                        "price": "0.01",
                        "currency": "USD",
                    }
                ],
                "total_amount": "0.01",
                "currency": "USD",
            },
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_201_CREATED,
        )
        order = Order.objects.get(pk=response.json()["id"])
        self.assertEqual(order.total_amount, Decimal("40.00"))
        self.assertEqual(order.currency, "AZN")
        self.assertEqual(
            response.json()["items"][0]["ticket_type_id"],
            ticket_data["id"],
        )

    def test_mixed_event_ticket_types_are_rejected(self):
        other_event = Event.objects.create(
            organizer=self.organizer,
            category=self.category,
            venue=self.venue,
            title="Other Public Event",
            description="Başqa event",
            start_at=self.event.start_at,
            end_at=self.event.end_at,
            status=Event.Status.PUBLISHED,
        )
        other_ticket_type = TicketType.objects.create(
            event=other_event,
            name="Other Standard",
            price=Decimal("10.00"),
            capacity=10,
            max_per_order=2,
            is_active=True,
        )
        self.client.force_authenticate(user=self.buyer)

        response = self.client.post(
            reverse("order-create"),
            {
                "items": [
                    {
                        "ticket_type_id": self.ticket_type.id,
                        "quantity": 1,
                    },
                    {
                        "ticket_type_id": other_ticket_type.id,
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

    def test_non_public_inactive_and_outside_window_orders_are_blocked(
        self,
    ):
        inactive = TicketType.objects.create(
            event=self.event,
            name="Inactive Order",
            price=Decimal("10.00"),
            capacity=10,
            max_per_order=2,
            is_active=False,
        )
        upcoming = TicketType.objects.create(
            event=self.event,
            name="Upcoming Order",
            price=Decimal("10.00"),
            capacity=10,
            max_per_order=2,
            sales_start_at=timezone.now() + timedelta(days=1),
            is_active=True,
        )
        self.client.force_authenticate(user=self.buyer)

        for ticket_type in [
            self.draft_ticket_type,
            inactive,
            upcoming,
        ]:
            with self.subTest(ticket_type=ticket_type.name):
                response = self.client.post(
                    reverse("order-create"),
                    {
                        "items": [
                            {
                                "ticket_type_id": ticket_type.id,
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

    def test_public_sold_out_type_preserves_capacity_409_contract(self):
        self.create_order_item(
            quantity=self.ticket_type.capacity,
            status=Order.Status.PAID,
        )
        ticket_data = self.public_ticket_data()
        self.client.force_authenticate(user=self.buyer)

        response = self.client.post(
            reverse("order-create"),
            {
                "items": [
                    {
                        "ticket_type_id": ticket_data["id"],
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
        self.assertEqual(
            response.json()["code"],
            "INSUFFICIENT_CAPACITY",
        )
        self.assertEqual(response.json()["available_quantity"], 0)


User = get_user_model()


class OrganizerEventAPITests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.organizer = User.objects.create_user(
            email="organizer@hara.today",
            password="StrongPass123!",
            account_type="organizer",
        )
        cls.other_organizer = User.objects.create_user(
            email="other@hara.today",
            password="StrongPass123!",
            account_type="organizer",
        )
        cls.attendee = User.objects.create_user(
            email="attendee@hara.today",
            password="StrongPass123!",
            account_type="attendee",
        )

        cls.category = Category.objects.create(
            name="Musiqi",
            slug="organizer-test-musiqi",
        )
        cls.venue = Venue.objects.create(
            name="Organizer Test Məkanı",
            city="Bakı",
            address="Nizami küçəsi 1",
            location=Point(49.84, 40.37, srid=4326),
        )

        start_at = timezone.now() + timedelta(days=10)

        cls.editable_event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Dəyişdirilə bilən tədbir",
            description="Bilet satılmayıb",
            start_at=start_at,
            end_at=start_at + timedelta(hours=2),
            status=Event.Status.DRAFT,
        )

        cls.locked_event = Event.objects.create(
            organizer=cls.organizer,
            category=cls.category,
            venue=cls.venue,
            title="Bilet satılmış tədbir",
            description="Edit və delete bloklanmalıdır",
            start_at=start_at,
            end_at=start_at + timedelta(hours=2),
            status=Event.Status.PUBLISHED,
        )

        cls.other_event = Event.objects.create(
            organizer=cls.other_organizer,
            category=cls.category,
            venue=cls.venue,
            title="Başqa təşkilatçının tədbiri",
            description="Görünməməlidir",
            start_at=start_at,
            end_at=start_at + timedelta(hours=2),
            status=Event.Status.DRAFT,
        )

        ticket_type = TicketType.objects.create(
            event=cls.locked_event,
            name="Standart",
            price=Decimal("20.00"),
            capacity=100,
        )
        order = Order.objects.create(
            buyer=cls.attendee,
            status=Order.Status.PAID,
            total_amount=Decimal("20.00"),
            paid_at=timezone.now(),
        )
        order_item = OrderItem.objects.create(
            order=order,
            ticket_type=ticket_type,
            quantity=1,
            unit_price=Decimal("20.00"),
        )
        cls.ticket = Ticket.objects.create(
            order_item=order_item,
            event=cls.locked_event,
            owner=cls.attendee,
            status=Ticket.Status.VALID,
        )

    def setUp(self):
        self.client.force_authenticate(user=self.organizer)

    def test_organizer_sees_only_own_events(self):
        response = self.client.get(reverse("organizer-event-list"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        returned_ids = {item["id"] for item in response.json()}

        self.assertIn(str(self.editable_event.id), returned_ids)
        self.assertIn(str(self.locked_event.id), returned_ids)
        self.assertNotIn(str(self.other_event.id), returned_ids)

    def test_create_assigns_authenticated_organizer(self):
        start_at = timezone.now() + timedelta(days=20)

        response = self.client.post(
            reverse("organizer-event-list"),
            {
                "title": "Yeni organizer tədbiri",
                "description": "API ilə yaradılıb",
                "category_id": self.category.pk,
                "venue_id": self.venue.pk,
                "start_at": start_at.isoformat(),
                "end_at": (
                    start_at + timedelta(hours=2)
                ).isoformat(),
                "status": Event.Status.DRAFT,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        created_event = Event.objects.get(id=response.json()["id"])
        self.assertEqual(created_event.organizer, self.organizer)
        self.assertFalse(created_event.is_featured)

    def test_attendee_cannot_access_organizer_api(self):
        self.client.force_authenticate(user=self.attendee)

        response = self.client.get(reverse("organizer-event-list"))

        self.assertEqual(
            response.status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_other_organizer_event_returns_404(self):
        response = self.client.get(
            reverse(
                "organizer-event-detail",
                kwargs={"slug": self.other_event.slug},
            )
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_event_without_ticket_can_be_edited(self):
        response = self.client.patch(
            reverse(
                "organizer-event-detail",
                kwargs={"slug": self.editable_event.slug},
            ),
            {"title": "Yenilənmiş tədbir"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.editable_event.refresh_from_db()
        self.assertEqual(
            self.editable_event.title,
            "Yenilənmiş tədbir",
        )

    def test_event_without_ticket_can_be_deleted(self):
        response = self.client.delete(
            reverse(
                "organizer-event-detail",
                kwargs={"slug": self.editable_event.slug},
            )
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_204_NO_CONTENT,
        )
        self.assertFalse(
            Event.objects.filter(id=self.editable_event.id).exists()
        )

    def test_ticketed_event_cannot_be_edited(self):
        response = self.client.patch(
            reverse(
                "organizer-event-detail",
                kwargs={"slug": self.locked_event.slug},
            ),
            {"title": "Qadağan olunmuş dəyişiklik"},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )

        self.locked_event.refresh_from_db()
        self.assertEqual(
            self.locked_event.title,
            "Bilet satılmış tədbir",
        )

    def test_ticketed_event_cannot_be_deleted(self):
        response = self.client.delete(
            reverse(
                "organizer-event-detail",
                kwargs={"slug": self.locked_event.slug},
            )
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertTrue(
            Event.objects.filter(id=self.locked_event.id).exists()
        )

    def test_refunded_ticket_still_keeps_event_locked(self):
        self.ticket.status = Ticket.Status.REFUNDED
        self.ticket.save(update_fields=["status"])

        response = self.client.patch(
            reverse(
                "organizer-event-detail",
                kwargs={"slug": self.locked_event.slug},
            ),
            {"description": "Dəyişdirilməyə cəhd"},
            format="json",
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_409_CONFLICT,
        )
