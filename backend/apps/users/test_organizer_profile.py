from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

User = get_user_model()


class OrganizerProfileTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="owner@example.com", password="Password123!")
        self.other = User.objects.create_user(email="other@example.com", password="Password123!")
        self.client.force_authenticate(self.user)
        self.payload = dict(display_name="Organizer", phone_number="+994 50 456 78 90",
                            organizer_name="Events", organizer_description="Live music",
                            organizer_website="https://example.com", tax_id="1234567890", tax_legal_name="Organizer Legal")

    def test_save_reload_private_and_cannot_escalate_account(self):
        result = self.client.patch('/api/auth/me/', {**self.payload, 'account_type': 'organizer', 'is_staff': True}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        self.user.refresh_from_db()
        self.assertEqual(self.user.tax_id, self.payload['tax_id'])
        self.assertEqual(self.user.phone_number, '+994504567890')
        self.assertEqual(self.user.account_type, 'user')
        self.assertFalse(self.user.is_staff)
        self.assertEqual(self.client.get('/api/auth/me/').data['tax_legal_name'], 'Organizer Legal')
        self.assertEqual(result['Cache-Control'], 'private, no-store')
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get('/api/auth/me/').data['tax_id'], '')

    def test_invalid_save_is_atomic(self):
        result = self.client.patch('/api/auth/me/', {**self.payload, 'tax_id': 'abc'}, format='json')
        self.assertEqual(result.status_code, 400)
        self.assertIn('tax_id', result.data)
        self.user.refresh_from_db()
        self.assertEqual(self.user.organizer_name, '')

    def test_required_legal_name_and_unsafe_website(self):
        for change in ({'tax_legal_name': ''}, {'organizer_website': 'javascript:alert(1)'}):
            result = self.client.patch('/api/auth/me/', {**self.payload, **change}, format='json')
            self.assertEqual(result.status_code, 400)

    def test_regular_profile_edit_does_not_require_tax_fields(self):
        result = self.client.patch('/api/auth/me/', {'display_name': 'Free event user'}, format='json')
        self.assertEqual(result.status_code, 200)

    def test_anonymous_cannot_access_tax_data(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)
