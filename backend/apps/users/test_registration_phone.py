from django.core import mail
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from .models import User
from .serializers import RegistrationSerializer


class RegistrationPhoneValidationTests(SimpleTestCase):
    def test_accepts_sample_number_and_supported_separators(self):
        for phone in ["+994507891234", "+994 50 789 12 34", "+994 (50) 789-12-34"]:
            with self.subTest(phone=phone):
                self.assertEqual(RegistrationSerializer().validate_phone_number(phone), "+994507891234")

    def test_rejects_wrong_prefix_length_letters_and_unicode_digits(self):
        for phone in ["507891234", "+995507891234", "+99450789123", "+9945078912345",
                      "+99450abc1234", "+994５０７８９１２３４"]:
            with self.subTest(phone=phone), self.assertRaises(ValidationError):
                RegistrationSerializer().validate_phone_number(phone)

    def test_rejects_whole_number_patterns(self):
        for digits in ["000000000", "555555555", "123456789", "987654321", "789012345", "321098765"]:
            with self.subTest(digits=digits), self.assertRaises(ValidationError):
                RegistrationSerializer().validate_phone_number("+994" + digits)


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class RegistrationPhoneApiTests(APITestCase):
    def test_direct_requests_cannot_bypass_phone_validation(self):
        for index, phone in enumerate(["+994111111111", "+994123456789", "+9945078912345", "+99450abc1234"]):
            response = self.client.post(reverse("auth-register"), {
                "first_name": "Phone", "last_name": "Test", "email": f"phone{index}@example.com",
                "phone_number": phone, "password": "SecurePass1", "password_confirm": "SecurePass1",
                "accept_terms": True,
            }, format="json")
            self.assertEqual(response.status_code, 400)
            self.assertIn("phone_number", response.data)
        self.assertFalse(User.objects.exists())
        self.assertEqual(len(mail.outbox), 0)
