import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase, APITransactionTestCase

from ticketing.checkins.services import check_in_ticket, TicketCheckInConflict
from ticketing.models import Order, OrderItem, Payment, RefundRequest, Ticket
from ticketing.orders.reservations import reserve_order, OrderReservationError
from ticketing.payments.services import initiate_payment, process_payment_event
from .models import Event, EventCancellation, EventSubmission, Notification, SubmissionReviewLog
from .review_service import review_submission
from . import test_reviews


@override_settings(ALLOWED_HOSTS=['localhost', 'testserver'], PAYMENT_PROVIDER='sandbox', PAYMENT_SANDBOX_ENABLED=True)
class CancellationTests(APITestCase):
    act = test_reviews.TeamReviewTests.act

    def setUp(self):
        test_reviews.TeamReviewTests.setUp(self)
        self.assertEqual(self.act('approved', '').status_code, 200)
        self.event = EventSubmission.objects.get(pk=self.pk).event
        self.ticket_type = self.event.ticket_types.get()
        self.buyer = get_user_model().objects.create_user(email='paid@example.com')
        self.free_buyer = get_user_model().objects.create_user(email='free@example.com')

    def purchased(self, buyer, price='25.00', quantity=1, refunded=False):
        amount = Decimal(price) * quantity
        order = Order.objects.create(buyer=buyer, status='refunded' if refunded else 'paid', total_amount=amount, paid_at=timezone.now())
        item = OrderItem.objects.create(order=order, ticket_type=self.ticket_type, quantity=quantity, unit_price=price)
        Payment.objects.create(order=order, amount=amount, status='refunded' if refunded else 'succeeded', provider='sandbox' if amount else 'free')
        tickets = [Ticket.objects.create(order_item=item, event=self.event, owner=buyer, status='refunded' if refunded else 'valid') for _ in range(quantity)]
        return order, tickets

    def pending(self):
        return reserve_order(buyer=self.buyer, items=[{'ticket_type_id': self.ticket_type.pk, 'quantity': 1}]).order

    def succeed(self, payment, event_id='late-success'):
        return process_payment_event(provider=payment.provider, provider_reference=payment.provider_reference,
            amount=payment.amount, currency=payment.currency, event_id=event_id, event_type='payment.succeeded')

    def test_cancel_mixed_event_uses_purchase_prices_and_notifies_each_buyer_once(self):
        paid, tickets = self.purchased(self.buyer, quantity=2)
        second, _ = self.purchased(self.buyer)
        free, _ = self.purchased(self.free_buyer, price='0.00')
        refunded, refunded_tickets = self.purchased(self.viewer, refunded=True)
        # Later catalogue edits must not turn paid purchases into free ones.
        self.ticket_type.price = 0; self.ticket_type.save()
        tickets[0].status = 'used'; tickets[0].used_at = timezone.now(); tickets[0].save()
        payload = {'request_id': str(uuid.uuid4()), 'version': self.client.get(self.url).data['version'],
                   'action': 'cancelled', 'body': 'Məkan fəaliyyətini dayandırıb.'}
        response = self.client.post(self.url, payload, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['status'], 'cancelled')
        self.assertEqual({row['amount'] for row in response.data['refund_requests']}, {'50.00', '25.00'})
        self.assertEqual(response.data['history'][0]['action'], 'cancelled')
        self.assertFalse(Ticket.objects.exclude(status__in=['cancelled', 'refunded']).exists())
        tickets[0].refresh_from_db(); self.assertIsNotNone(tickets[0].used_at)
        self.assertEqual(RefundRequest.objects.count(), 2)
        self.assertFalse(RefundRequest.objects.filter(order__in=[free, refunded]).exists())
        self.assertEqual(Notification.objects.filter(user=self.buyer, type='refund_pending').count(), 1)
        self.assertEqual(Notification.objects.filter(user=self.free_buyer, type='event_cancelled').count(), 1)
        self.assertFalse(Notification.objects.filter(user=self.viewer).exists())
        self.assertFalse(Notification.objects.filter(user=self.owner).exists())
        paid.refresh_from_db(); self.assertEqual(paid.status, 'paid')
        self.assertEqual(paid.payments.get().status, 'succeeded')
        self.assertEqual(refunded_tickets[0].status, 'refunded')
        self.ticket_type.refresh_from_db(); self.assertFalse(self.ticket_type.is_active)
        self.assertEqual(self.client.post(self.url, payload, format='json').status_code, 200)
        self.assertEqual(RefundRequest.objects.count(), 2); self.assertEqual(Notification.objects.count(), 2)
        self.assertEqual(EventCancellation.objects.count(), 1)
        self.assertEqual(self.act('cancelled', 'Again').status_code, 409)
        self.assertEqual(self.act('approved', '').status_code, 409)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(self.owner_url).data['note'], payload['body'])
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f'/api/events/{self.event.slug}/').status_code, 404)

    def test_requires_moderation_permission_reason_published_state_and_fresh_version(self):
        version = self.client.get(self.url).data['version']
        for user, code in [(None, 401), (self.owner, 403), (self.viewer, 403)]:
            self.client.force_authenticate(user)
            self.assertEqual(self.client.post(self.url, {'request_id': str(uuid.uuid4()), 'version': version,
                'action': 'cancelled', 'body': 'Cancel'}, format='json').status_code, code)
        self.client.force_authenticate(self.reviewer)
        self.assertEqual(self.act('cancelled', ' ').status_code, 400)
        self.act('comment', 'Another review')
        self.assertEqual(self.act('cancelled', 'Cancel', version=version).status_code, 409)
        Event.objects.filter(pk=self.event.pk).update(status='draft')
        self.assertEqual(self.act('cancelled', 'Cancel').status_code, 409)
        self.assertFalse(EventCancellation.objects.exists())

    def test_owned_ticket_refund_status_comes_from_the_actual_refund_queue(self):
        paid, tickets = self.purchased(self.buyer)
        _, free_tickets = self.purchased(self.free_buyer, price='0.00')
        _, refunded_tickets = self.purchased(self.viewer, refunded=True)
        self.assertEqual(self.act('cancelled', 'Məkan bağlıdır').status_code, 200)
        self.client.force_authenticate(self.buyer)
        url = f'/api/tickets/{tickets[0].pk}/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['refund_status'], 'pending')
        self.assertEqual(response.data['cancellation_reason'], 'Məkan bağlıdır')
        self.assertTrue(response.data['event_cover_thumbnail'].startswith('data:image/jpeg;base64,'))
        self.assertEqual(self.client.get('/api/tickets/').data[0]['refund_status'], 'pending')
        RefundRequest.objects.filter(order=paid).delete()
        self.assertIsNone(self.client.get(url).data['refund_status'])
        self.client.force_authenticate(self.free_buyer)
        self.assertIsNone(self.client.get(f'/api/tickets/{free_tickets[0].pk}/').data['refund_status'])
        self.assertEqual(self.client.get(url).status_code, 404)
        self.client.force_authenticate(self.viewer)
        self.assertEqual(self.client.get(f'/api/tickets/{refunded_tickets[0].pk}/').data['refund_status'], 'refunded')

    def test_previously_refunded_tickets_and_payments_are_not_queued_again(self):
        partial, tickets = self.purchased(self.buyer, quantity=2)
        tickets[0].status = 'refunded'; tickets[0].save()
        fully_refunded, _ = self.purchased(self.free_buyer)
        fully_refunded.payments.update(status='refunded')
        self.assertEqual(self.act('cancelled', 'Cancel').status_code, 200)
        refund = RefundRequest.objects.get()
        self.assertEqual(refund.order_id, partial.pk)
        self.assertEqual(refund.amount, Decimal('25.00'))
        self.assertFalse(Notification.objects.filter(user=self.free_buyer, type='refund_pending').exists())

    def test_notification_failure_rolls_back_cancellation_tickets_and_refund_queue(self):
        self.purchased(self.buyer)
        with patch('events.cancellations.notify_cancellation', side_effect=RuntimeError('DB unavailable')):
            with self.assertRaises(RuntimeError): self.act('cancelled', 'Cancel')
        self.event.refresh_from_db(); self.assertEqual(self.event.status, 'published')
        self.assertEqual(Ticket.objects.get().status, 'valid')
        self.assertFalse(RefundRequest.objects.exists())
        self.assertFalse(EventCancellation.objects.exists())
        self.assertFalse(SubmissionReviewLog.objects.filter(action='cancelled').exists())

    def test_late_payment_creates_one_refund_and_no_ticket_or_new_checkout(self):
        order = self.pending()
        payment = initiate_payment(order_id=order.pk, buyer=self.buyer).payment
        self.assertEqual(self.act('cancelled', 'Cancel').status_code, 200)
        order.refresh_from_db(); self.assertEqual(order.status, 'cancelled')
        self.assertFalse(Notification.objects.exists())
        self.assertIsNotNone(initiate_payment(order_id=order.pk, buyer=self.buyer).conflict)
        with self.assertRaises(OrderReservationError): self.pending()
        self.assertEqual(self.succeed(payment).outcome, 'conflict')
        self.assertEqual(self.succeed(payment).outcome, 'duplicate')
        self.assertEqual(self.succeed(payment, 'another-provider-delivery').outcome, 'ignored')
        self.assertFalse(Ticket.objects.exists())
        self.assertEqual(RefundRequest.objects.get().amount, Decimal('25.00'))
        self.assertEqual(Notification.objects.get().type, 'refund_pending')
        payment.refresh_from_db(); self.assertEqual(payment.status, 'succeeded')
        order.refresh_from_db(); self.assertEqual(order.status, 'cancelled')

    def test_free_checkout_and_previously_used_qr_are_blocked_after_cancellation(self):
        _, tickets = self.purchased(self.free_buyer, price='0.00')
        check_in_ticket(event=self.event, qr_code=tickets[0].qr_code, organizer=self.owner)
        self.ticket_type.price = 0; self.ticket_type.save()
        pending = self.pending()
        self.act('cancelled', 'Cancel')
        self.assertIsNotNone(initiate_payment(order_id=pending.pk, buyer=self.buyer).conflict)
        with self.assertRaises(TicketCheckInConflict):
            check_in_ticket(event=self.event, qr_code=tickets[0].qr_code, organizer=self.owner)
        self.assertEqual(Notification.objects.get().type, 'event_cancelled')
        self.assertFalse(RefundRequest.objects.exists())

    def test_inbox_is_private_and_read_receipts_are_idempotent(self):
        self.purchased(self.buyer); self.purchased(self.free_buyer, price='0.00')
        self.act('cancelled', 'Məkan bağlıdır')
        self.client.force_authenticate(self.buyer)
        data = self.client.get('/api/notifications/inbox/')
        self.assertEqual(data.status_code, 200)
        self.assertIn('no-store', data['Cache-Control'])
        self.assertEqual(data.data['count'], 1); self.assertEqual(data.data['unread_count'], 1)
        self.assertEqual(data.data['results'][0]['cancellation_reason'], 'Məkan bağlıdır')
        self.assertEqual(data.data['results'][0]['event_status'], 'cancelled')
        pk = data.data['results'][0]['id']
        read_url = f'/api/notifications/{pk}/read/'
        first = self.client.post(read_url).data['read_at']
        self.assertEqual(self.client.post(read_url).data['read_at'], first)
        self.assertEqual(self.client.get('/api/notifications/unread-count/').data['unread_count'], 0)
        self.client.force_authenticate(self.free_buyer)
        self.assertEqual(self.client.post(read_url).status_code, 404)
        self.assertEqual(self.client.get('/api/notifications/unread-count/').data['unread_count'], 1)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/notifications/inbox/').status_code, 401)
        self.assertEqual(self.client.post(read_url).status_code, 401)


@override_settings(ALLOWED_HOSTS=['localhost', 'testserver'], PAYMENT_PROVIDER='sandbox', PAYMENT_SANDBOX_ENABLED=True)
class ConcurrentCancellationTests(APITransactionTestCase):
    setUp = CancellationTests.setUp
    act = test_reviews.TeamReviewTests.act
    pending = CancellationTests.pending
    succeed = CancellationTests.succeed

    def race(self, purchase):
        barrier = Barrier(2)
        def run(cancel):
            close_old_connections()
            try:
                with connections['default'].cursor() as cursor:
                    cursor.execute("SET statement_timeout = '15000'")
                barrier.wait(timeout=10)
                if cancel:
                    review_submission(self.pk, self.reviewer, action='cancelled', body='Cancel', request_id=uuid.uuid4())
                else:
                    purchase()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(run, [True, False]))

    def test_payment_and_cancellation_serialize_without_live_tickets_or_lost_refunds(self):
        order = self.pending()
        payment = initiate_payment(order_id=order.pk, buyer=self.buyer).payment
        self.race(lambda: self.succeed(payment))
        self.event.refresh_from_db(); self.assertEqual(self.event.status, 'cancelled')
        self.assertFalse(Ticket.objects.exclude(status='cancelled').exists())
        self.assertEqual(RefundRequest.objects.count(), 1)
        self.assertEqual(Notification.objects.filter(user=self.buyer, type='refund_pending').count(), 1)
        payment.refresh_from_db(); self.assertEqual(payment.status, 'succeeded')

    def test_reservation_and_cancellation_leave_no_pending_orders(self):
        def purchase():
            try: self.pending()
            except OrderReservationError as error: self.assertEqual(error.status_code, 409)
        self.race(purchase)
        self.assertFalse(Order.objects.filter(status='pending').exists())
        self.assertFalse(Ticket.objects.exists())
        self.assertFalse(RefundRequest.objects.exists())

    def test_creator_buying_own_ticket_does_not_deadlock_moderation(self):
        self.buyer = self.owner
        self.test_payment_and_cancellation_serialize_without_live_tickets_or_lost_refunds()
