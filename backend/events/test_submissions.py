import base64
import copy
import io
import uuid
from unittest.mock import patch
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.test import RequestFactory, override_settings
from PIL import Image
from rest_framework.test import APITestCase
from .models import Category, Event, EventSubmission, Venue, VenuePlan, VenueSection, VenueSeat
from .test_seat_plans import layout
from .admin import EventSubmissionAdmin
from ticketing.orders.reservations import reserve_order, OrderReservationError


def draft():
    buffer = io.BytesIO(); Image.new('RGB', (32, 18), 'purple').save(buffer, format='JPEG')
    photo = 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()
    return {'title': 'Caz', 'category': 'musiqi', 'description': 'Canlı musiqi', 'age': '18+', 'language': 'az', 'duration': '120', 'lastStep': 5,
            'schedule': {'startDate': '2099-10-28', 'startTime': '20:00', 'endDate': '2099-10-28', 'endTime': '22:00', 'endEdited': False, 'venue': {'id': None, 'source': 'manual', 'name': 'Hall', 'address': 'Address', 'latitude': 40, 'longitude': 49, 'entry_note': '', 'capacity': None, 'plan_id': None}},
            'sales': {'admissionType': 'general', 'capacity': '60', 'tickets': [{'id': 'standard', 'name': 'Standart', 'paymentType': 'paid', 'price': '25', 'quantity': '58', 'includes': 'Giriş'}], 'salesStart': 'published', 'salesEnd': 'event_start', 'minPerOrder': '1', 'maxPerOrder': '6', 'refundPolicy': 'until_24h'}, 'media': {'cover': photo, 'gallery': [photo]}}


@override_settings(ALLOWED_HOSTS=['localhost', 'testserver'])
class SubmissionTests(APITestCase):
    def setUp(self):
        # Generated media URLs go through the real URLField validator. Django's
        # default "testserver" is not a valid public hostname; localhost is.
        self.client.defaults['HTTP_HOST'] = 'localhost'
        self.owner = get_user_model().objects.create_user(email='review@example.com', password='Example9Pass', account_type='organizer', display_name='Organizer', phone_number='0501234567', is_email_verified=True)
        self.other = get_user_model().objects.create_user(email='other@example.com', password='Example9Pass')
        Category.objects.create(name='Musiqi', slug='musiqi')
        self.client.force_authenticate(self.owner)
        self.pk = uuid.uuid4(); self.url = f'/api/event-submissions/{self.pk}/'; self.data = draft()

    def send(self, data=None): return self.client.put(self.url, {'snapshot': data or self.data}, format='json')

    def test_submission_is_private_and_retry_does_not_duplicate(self):
        response = self.send(); self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['status'], 'pending')
        event = Event.objects.get(); self.assertEqual(event.status, 'draft')
        self.assertEqual(event.ticket_types.get().capacity, 58)
        self.assertEqual(event.ticket_types.get().price, 25)
        self.assertEqual(self.send().status_code, 200)
        self.assertEqual(EventSubmission.objects.count(), 1); self.assertEqual(Event.objects.count(), 1)
        self.assertEqual(self.client.get(f'/api/events/{event.slug}/').status_code, 404)
        self.assertEqual(self.client.get(f'{self.url}images/0/').status_code, 404)
        self.assertEqual(self.client.get(self.url).data['snapshot']['media'], self.data['media'])

    def test_authentication_and_cross_owner_read_write(self):
        self.send(); self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.send().status_code, 404)
        self.assertEqual(self.client.get('/api/event-submissions/').data, [])
        self.client.force_authenticate(None)
        self.assertEqual(self.send().status_code, 401)

    def test_eligibility_does_not_promote_ordinary_accounts(self):
        self.client.force_authenticate(self.other)
        self.assertFalse(self.client.get('/api/event-submissions/eligibility/').data['eligible'])
        self.assertEqual(self.send().status_code, 403)
        self.other.refresh_from_db(); self.assertEqual(self.other.account_type, 'user')
        self.assertEqual(Event.objects.count(), 0)

    def use_default_account(self):
        self.owner.account_type = 'user'
        self.owner.save()

    def make_free(self):
        self.data['sales']['tickets'][0].update(paymentType='free', price='')
        self.data['sales']['refundPolicy'] = ''

    def test_default_account_can_submit_free_event_and_staff_can_publish(self):
        self.use_default_account(); self.make_free()
        self.assertTrue(self.client.get('/api/event-submissions/eligibility/?payment_type=free').data['eligible'])
        response = self.send(); self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['status'], 'pending')
        self.assertEqual(self.send().status_code, 200)
        event = Event.objects.get(); self.assertEqual(event.ticket_types.get().price, 0)
        self.assertEqual(self.client.patch(f'/api/organizer/events/{event.slug}/', {'status': 'published'}, format='json').status_code, 403)
        reviewer = EventSubmissionAdmin(EventSubmission, admin.site)
        request = RequestFactory().post('/admin/'); request.user = self.owner
        with patch.object(reviewer, 'message_user'), patch.object(reviewer, 'log_change'):
            reviewer.approve_and_publish(request, EventSubmission.objects.all())
        event.refresh_from_db(); self.assertEqual(event.status, 'published')
        self.owner.refresh_from_db(); self.assertEqual(self.owner.account_type, 'user')

    def test_default_account_cannot_submit_paid_or_mixed_event_with_free_hint(self):
        self.use_default_account()
        self.assertFalse(self.client.get('/api/event-submissions/eligibility/').data['eligible'])
        self.url += '?payment_type=free'
        self.assertEqual(self.send().status_code, 403)
        self.data['sales']['tickets'].append({**self.data['sales']['tickets'][0], 'id': 'free', 'paymentType': 'free', 'price': ''})
        self.assertEqual(self.send().status_code, 403)
        self.assertEqual(Event.objects.count(), 0)

    def test_free_event_still_requires_verified_complete_profile(self):
        self.use_default_account(); self.make_free()
        for field, value in [('phone_number', ''), ('is_email_verified', False)]:
            original = getattr(self.owner, field); setattr(self.owner, field, value); self.owner.save()
            self.assertFalse(self.client.get('/api/event-submissions/eligibility/?payment_type=free').data['eligible'])
            self.assertEqual(self.send().status_code, 403)
            setattr(self.owner, field, original); self.owner.save()

    def test_default_account_cannot_change_free_submission_to_paid(self):
        self.use_default_account(); self.make_free(); self.assertEqual(self.send().status_code, 201)
        item = EventSubmission.objects.get(); item.status = 'changes_requested'; item.save()
        self.data['sales']['tickets'][0].update(paymentType='paid', price='25')
        self.assertEqual(self.send().status_code, 403)
        self.make_free(); self.data['title'] = 'Updated free event'
        self.assertEqual(self.send().status_code, 200)
        event = Event.objects.get(); event.ticket_types.update(price=25)
        reviewer = EventSubmissionAdmin(EventSubmission, admin.site)
        request = RequestFactory().post('/admin/'); request.user = self.owner
        with patch.object(reviewer, 'message_user'), patch.object(reviewer, 'log_change'):
            reviewer.approve_and_publish(request, EventSubmission.objects.all())
        event.refresh_from_db(); self.assertEqual(event.status, 'draft')

    def test_incomplete_profile_and_unverified_email_are_blocked(self):
        for field, value in [('phone_number', ''), ('is_email_verified', False)]:
            original = getattr(self.owner, field); setattr(self.owner, field, value); self.owner.save()
            self.assertEqual(self.send().status_code, 403)
            setattr(self.owner, field, original); self.owner.save()

    def test_invalid_data_rolls_back_all_entities(self):
        for field in ['cover', 'time', 'quantity', 'price', 'coordinates', 'window']:
            data = copy.deepcopy(self.data)
            if field == 'cover': data['media']['cover'] = 'data:image/jpeg;base64,YQ=='
            if field == 'time': data['schedule']['startDate'] = '2020-01-01'
            if field == 'quantity': data['sales']['tickets'][0]['quantity'] = '61'
            if field == 'price': data['sales']['tickets'][0]['price'] = '-1'
            if field == 'coordinates': data['schedule']['venue']['latitude'] = 99
            if field == 'window': data['sales'].update(salesStart='custom', salesStartDate='2099-10-29', salesStartTime='20:00')
            with self.subTest(field=field): self.assertEqual(self.send(data).status_code, 400)
        self.assertEqual(Event.objects.count(), 0); self.assertEqual(Venue.objects.count(), 0)

    def test_pending_snapshot_cannot_be_changed_or_published_by_owner(self):
        self.send(); changed = copy.deepcopy(self.data); changed['title'] = 'Changed'
        self.assertEqual(self.send(changed).status_code, 409)
        event = Event.objects.get()
        self.assertEqual(self.client.patch(f'/api/organizer/events/{event.slug}/', {'status': 'published'}, format='json').status_code, 409)
        ticket = event.ticket_types.get()
        self.assertEqual(self.client.patch(f'/api/organizer/events/{event.slug}/ticket-types/{ticket.pk}/', {'price': '1'}, format='json').status_code, 409)
        self.assertEqual(self.client.delete(f'/api/organizer/events/{event.slug}/ticket-types/{ticket.pk}/').status_code, 409)

    def test_changes_requested_resubmits_same_event(self):
        self.send(); item = EventSubmission.objects.get(); item.status = 'changes_requested'; item.note = 'Adı düzəlt'; item.save()
        self.data['title'] = 'Yeni ad'; response = self.send()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['status'], 'pending'); self.assertEqual(Event.objects.count(), 1)
        self.assertEqual(Event.objects.get().title, 'Yeni ad')

    def test_server_recomputes_catalog_capacity(self):
        venue = Venue.objects.create(name='Small hall', address='Baku', location=Point(49, 40))
        plan = VenuePlan.objects.create(venue=venue, name='Plan', status='published')
        VenueSection.objects.create(venue_plan=plan, name='Hall', code='hall', capacity=20)
        self.data['schedule']['venue'].update(id=str(venue.pk), source='catalog', capacity=1000)
        self.assertEqual(self.send().status_code, 400)

    def test_seat_plan_preserves_60_total_58_active_and_prices(self):
        self.data['sales'].update(admissionType='seated', seatPlanApplied=True, seatPlan=layout())
        self.data['sales']['seatPlan']['venueKey'] = 'manual:hall|address|40|49'
        for seat in self.data['sales']['seatPlan']['blocks'][0]['seats']:
            if seat['blocked']: seat['categoryId'] = None
        response = self.send(); self.assertEqual(response.status_code, 201, response.data)
        event = Event.objects.get(); seats = VenueSeat.objects.filter(section__venue_plan=event.venue_plan)
        self.assertEqual(seats.count(), 60)
        self.assertEqual(seats.filter(is_active=True).count(), 58)
        self.assertEqual(event.ticket_types.get().capacity, 58)
        self.assertEqual(event.ticket_types.get().price, 25)

    def test_tampered_seat_ticket_quantity_is_rejected(self):
        self.data['sales'].update(admissionType='seated', seatPlanApplied=True, seatPlan=layout())
        self.data['sales']['seatPlan']['venueKey'] = 'manual:hall|address|40|49'
        self.data['sales']['tickets'][0]['quantity'] = '57'
        self.assertEqual(self.send().status_code, 400)

    def test_seat_geometry_is_preserved_and_outside_canvas_is_rejected(self):
        plan = layout(); plan['venueKey'] = 'manual:hall|address|40|49'
        plan['background'] = self.data['media']['cover']
        plan['blocks'][0].update(x=200, y=30, scale=0.5, rotation=90)
        self.data['sales'].update(admissionType='seated', seatPlanApplied=True, seatPlan=plan)
        response = self.send(); self.assertEqual(response.status_code, 201, response.data)
        event = Event.objects.get()
        seat = event.venue_plan.sections.get().seats.get(row_label='1:A', seat_number='1')
        self.assertEqual(float(seat.x), 200); self.assertEqual(float(seat.y), 42)
        self.assertEqual(self.client.get(f'{self.url}images/5/').status_code, 404)
        event.status = 'published'; event.save()
        self.assertEqual(self.client.get(f'{self.url}images/5/').status_code, 200)
        self.pk = uuid.uuid4(); self.url = f'/api/event-submissions/{self.pk}/'
        plan['blocks'][0]['x'] = -400
        self.assertEqual(self.send().status_code, 400)

    def test_order_limits_apply_across_ticket_types(self):
        self.data['sales']['minPerOrder'] = '2'
        self.data['sales']['tickets'][0]['quantity'] = '30'
        self.data['sales']['tickets'].append({**self.data['sales']['tickets'][0], 'id': 'vip', 'name': 'VIP'})
        self.assertEqual(self.send().status_code, 201)
        event = Event.objects.get(); event.status = 'published'; event.save()
        tickets = list(event.ticket_types.all())
        for quantities in [(1, 0), (4, 3)]:
            items = [{'ticket_type_id': ticket.pk, 'quantity': quantity} for ticket, quantity in zip(tickets, quantities) if quantity]
            with self.assertRaises(OrderReservationError): reserve_order(buyer=self.other, items=items)
        result = reserve_order(buyer=self.other, items=[{'ticket_type_id': ticket.pk, 'quantity': 1} for ticket in tickets])
        self.assertTrue(result.created)

    def test_staff_approval_publishes_only_after_revalidation(self):
        response = self.client.put(self.url, {'snapshot': self.data}, format='json', HTTP_HOST='localhost')
        self.assertEqual(response.status_code, 201)
        reviewer = EventSubmissionAdmin(EventSubmission, admin.site)
        request = RequestFactory().post('/admin/'); request.user = self.owner
        with patch.object(reviewer, 'message_user'), patch.object(reviewer, 'log_change'):
            reviewer.approve_and_publish(request, EventSubmission.objects.all())
        event = Event.objects.get(); self.assertEqual(event.status, 'published')
        self.assertIsNotNone(event.published_at); self.assertTrue(event.venue.is_active)

    def test_published_status_and_media_are_derived_from_event(self):
        self.send(); event = Event.objects.get(); event.status = 'published'; event.save()
        self.assertEqual(self.client.get(self.url).data['status'], 'published')
        self.client.force_authenticate(None)
        response = self.client.get(f'{self.url}images/0/')
        self.assertEqual(response.status_code, 200); self.assertEqual(response['Content-Type'], 'image/jpeg')
        self.assertEqual(self.client.get(f'{self.url}images/5/').status_code, 404)
