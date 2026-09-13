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

from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase
from unittest.mock import patch
from .models import User
from .throttles import reserve_verification_send


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend", AUTH_SEND_IP_MAX_ATTEMPTS=100)
class DuplicateRegistrationTests(APITestCase):
    def test_existing_account_wins_over_email_cooldown(self):
        User.objects.create_user(email="existing@example.com", password="SecurePass1")
        reserve_verification_send("existing@example.com")
        with patch("apps.users.views.issue_verification_code") as send:
            response = self.client.post(reverse("auth-register"), {"email": "EXISTING@example.com"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "email_exists")
        self.assertNotIn("retry_after", response.data)
        send.assert_not_called()

    def test_email_and_ip_limits_are_distinguished(self):
        reserve_verification_send("pending@example.com")
        response = self.client.post(reverse("auth-register"), {"email": "pending@example.com"}, format="json")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.data["rate_limit_scope"], "email")
        response = self.client.post(reverse("auth-register"), {"email": "other@example.com"}, format="json")
        self.assertEqual(response.status_code, 400)  # Required fields, not cooldown.
        with self.settings(AUTH_SEND_IP_MAX_ATTEMPTS=1):
            response = self.client.post(reverse("auth-register"), {"email": "another@example.com"}, format="json")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.data["rate_limit_scope"], "ip")
