from datetime import timedelta
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase
from ticketing.models import TicketType
from .models import Category, Event, Venue, VenuePlan, VenueSection


class DiscoveryTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(email="discovery@example.com")
        self.category = Category.objects.create(name="Art", slug="art")
        self.venue = Venue.objects.create(name="Hall", address="Baku", location=Point(49.8, 40.4, srid=4326))
        self.event = Event.objects.create(organizer=self.user, category=self.category, venue=self.venue, title="Discovery", status="published", start_at=timezone.now()+timedelta(days=1), end_at=timezone.now()+timedelta(days=2))
        self.url = reverse("events:event-list")

    def test_price_is_live_database_value_and_missing_is_null(self):
        self.assertIsNone(self.client.get(self.url).json()[0]["min_price"])
        ticket = TicketType.objects.create(event=self.event, name="Standard", price="12.50", capacity=20)
        TicketType.objects.create(event=self.event, name="Hidden", price="0", capacity=20, is_active=False)
        self.assertEqual(self.client.get(self.url).json()[0]["min_price"], "12.50")
        ticket.price = 0
        ticket.save()
        self.assertEqual(self.client.get(self.url).json()[0]["min_price"], "0.00")

    def test_hidden_sections_do_not_set_minimum_price(self):
        plan = VenuePlan.objects.create(venue=self.venue, name="Plan")
        section = VenueSection.objects.create(venue_plan=plan, code="X", name="Closed", capacity=10, is_active=False)
        TicketType.objects.create(event=self.event, name="Closed", price="1", capacity=10, venue_section=section)
        self.assertIsNone(self.client.get(self.url).json()[0]["min_price"])

    def test_upcoming_excludes_ended_and_keeps_ongoing(self):
        self.event.start_at = timezone.now()-timedelta(days=1)
        self.event.save()
        self.assertEqual(len(self.client.get(self.url, {"upcoming": "true"}).json()), 1)
        self.event.end_at = timezone.now()-timedelta(hours=1)
        self.event.save()
        self.assertEqual(self.client.get(self.url, {"upcoming": "true"}).json(), [])
        self.assertEqual(len(self.client.get(self.url).json()), 1)
