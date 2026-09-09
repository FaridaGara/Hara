import copy
import uuid
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from .models import SeatingLayoutTemplate


def layout():
    return {'version': 1, 'id': str(uuid.uuid4()), 'venueKey': 'manual:Hall|Address|40|49', 'name': 'Hall', 'sourceId': '', 'sourceName': '', 'page': 1, 'pageCount': 1, 'background': '',
            'categories': [{'id': 'standard', 'name': 'Standart', 'price': '25', 'free': False}],
            'blocks': [{'id': 'block', 'name': 'Parter', 'rows': 6, 'columns': 10, 'firstRow': 'A', 'firstSeat': 1, 'aisle': 5, 'direction': 'ltr', 'x': 0, 'y': 0, 'scale': 1, 'rotation': 0,
                        'seats': [{'id': f'{r}{n}', 'row': r, 'number': n, 'x': n*24, 'y': i*26, 'blocked': r == 'F' and n >= 9, 'reason': '', 'categoryId': 'standard'} for i, r in enumerate('ABCDEF') for n in range(1,11)]}]}


class SeatPlanTemplateTests(APITestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user(email='seat-owner@example.com', password='StrongPass123!', account_type='user')
        self.other = get_user_model().objects.create_user(email='seat-other@example.com', password='StrongPass123!', account_type='user')
        self.client.force_authenticate(self.owner)
        self.data = layout()
        self.url = f"/api/seat-plans/{self.data['id']}/"

    def test_60_seats_58_for_sale_and_prices_not_reused(self):
        response = self.client.put(self.url, {'layout': self.data}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual((response.data['seat_count'], response.data['blocked_count']), (60, 2))
        self.assertEqual(response.data['layout']['categories'][0]['price'], '')
        self.assertEqual(len(response.data['layout']['blocks'][0]['seats']), 60)
        response = self.client.get('/api/seat-plans/', {'venue_key': self.data['venueKey']})
        self.assertEqual(len(response.data), 1)
        self.assertNotIn('layout', response.data[0])

    def test_requires_authentication(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/seat-plans/').status_code, 401)
        self.assertEqual(self.client.put(self.url, {'layout': self.data}, format='json').status_code, 401)

    def test_other_account_cannot_read_overwrite_or_list_template(self):
        self.client.put(self.url, {'layout': self.data}, format='json')
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.put(self.url, {'layout': self.data}, format='json').status_code, 404)
        self.assertEqual(self.client.get('/api/seat-plans/', {'venue_key': self.data['venueKey']}).data, [])
        self.assertEqual(SeatingLayoutTemplate.objects.get().owner_id, self.owner.id)

    def test_missing_price_duplicate_seat_and_unknown_category_rejected(self):
        for mutation in ('price', 'duplicate', 'category', 'all-blocked'):
            data = copy.deepcopy(self.data)
            if mutation == 'price': data['categories'][0]['price'] = ''
            if mutation == 'duplicate': data['blocks'][0]['seats'][1]['number'] = 1
            if mutation == 'category': data['blocks'][0]['seats'][0]['categoryId'] = 'missing'
            if mutation == 'all-blocked':
                for seat in data['blocks'][0]['seats']: seat['blocked'] = True
            with self.subTest(mutation=mutation):
                self.assertEqual(self.client.put(self.url, {'layout': data}, format='json').status_code, 400)
        self.assertEqual(SeatingLayoutTemplate.objects.count(), 0)

    def test_invalid_geometry_and_image_rejected(self):
        for mutation in ('scale', 'background', 'row'):
            data = copy.deepcopy(self.data)
            if mutation == 'scale': data['blocks'][0]['scale'] = -10
            if mutation == 'background': data['background'] = 'data:image/jpeg;base64,YmFk'
            if mutation == 'row': data['blocks'][0]['rows'] = 1.5
            with self.subTest(mutation=mutation):
                self.assertEqual(self.client.put(self.url, {'layout': data}, format='json').status_code, 400)

    def test_saving_twice_is_idempotent_and_free_category_is_supported(self):
        self.data['categories'][0].update(price='', free=True)
        for _ in range(2): self.assertEqual(self.client.put(self.url, {'layout': self.data}, format='json').status_code, 200)
        self.assertEqual(SeatingLayoutTemplate.objects.count(), 1)
        self.assertFalse(SeatingLayoutTemplate.objects.get().layout['categories'][0]['free'])
