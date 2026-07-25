from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from ticketing.models import Order, OrderItem, Ticket, TicketType

from .models import Category, Event, Venue
from django.test import TestCase


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