from django.test import SimpleTestCase
from rest_framework import serializers
from .serializers import RegistrationSerializer, validate_new_password


class RegistrationValidationTests(SimpleTestCase):
    def test_password_errors_are_azerbaijani(self):
        for password in ("abc", "12345678", "Password1"):
            try:
                validate_new_password(password)
            except serializers.ValidationError as exc:
                message = str(exc.detail)
                self.assertNotIn("This password", message)
                self.assertNotIn("too short", message)
        with self.assertRaises(serializers.ValidationError) as caught:
            validate_new_password("A1")
        self.assertIn("8 simvoldan", str(caught.exception.detail))

    def test_mobile_prefixes(self):
        serializer = RegistrationSerializer()
        for prefix in ("10", "50", "51", "55", "60", "70", "77", "99"):
            self.assertEqual(serializer.validate_phone_number(f"+994{prefix}7569083"), f"+994{prefix}7569083")
        for phone in ("9941923235", "+994197569083", "+9945075690831"):
            with self.assertRaises(serializers.ValidationError):
                serializer.validate_phone_number(phone)

    def test_email_error_is_azerbaijani(self):
        field = RegistrationSerializer().fields["email"]
        for email in ("random", "a@", "a b@example.com"):
            with self.assertRaises(serializers.ValidationError) as caught:
                field.run_validation(email)
            self.assertIn("Düzgün e-poçt", str(caught.exception.detail))
