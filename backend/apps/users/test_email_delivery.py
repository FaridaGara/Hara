from contextlib import redirect_stdout
from datetime import timedelta
from io import StringIO
from unittest.mock import Mock, patch

import requests
from django.contrib.auth.hashers import check_password
from django.core.mail import send_mail
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from .email_delivery import EmailDeliveryError, ensure_email_delivery_configured
from .models import User, VerificationCode
from .verification import issue_verification_code


RESEND_BACKEND = "apps.users.email_delivery.ResendEmailBackend"


def accepted_response():
    return Mock(status_code=200, json=Mock(return_value={"id": "synthetic-message-id"}))


@override_settings(EMAIL_BACKEND=RESEND_BACKEND, RESEND_API_KEY="re_test_only", DEBUG=False)
class ResendTransportTests(SimpleTestCase):
    def test_plain_text_email_uses_https_and_requires_provider_acknowledgement(self):
        with patch("apps.users.email_delivery.requests.post", return_value=accepted_response()) as post:
            result = send_mail("HARA test", "Synthetic body", "HARA <no-reply@hara.today>", ["test@example.com"])
        self.assertEqual(result, 1)
        self.assertEqual(post.call_args.args[0], "https://api.resend.com/emails")
        self.assertEqual(post.call_args.kwargs["json"], {
            "from": "HARA <no-reply@hara.today>", "to": ["test@example.com"],
            "subject": "HARA test", "text": "Synthetic body",
        })
        self.assertEqual(post.call_args.kwargs["timeout"], (3, 7))
        self.assertFalse(post.call_args.kwargs["allow_redirects"])

    def test_provider_errors_invalid_json_redirects_and_timeouts_are_not_success(self):
        responses = [
            Mock(status_code=401), Mock(status_code=429), Mock(status_code=503),
            Mock(status_code=302), Mock(status_code=200, json=Mock(return_value={})),
            Mock(status_code=200, json=Mock(side_effect=ValueError("private response"))),
        ]
        for response in responses:
            with self.subTest(response=response), patch("apps.users.email_delivery.requests.post", return_value=response):
                with self.assertRaises(EmailDeliveryError) as error:
                    send_mail("Test", "Synthetic body", "sender@example.com", ["test@example.com"])
                self.assertNotIn("private response", str(error.exception))
        with patch("apps.users.email_delivery.requests.post", side_effect=requests.Timeout("private transport error")) as post:
            with self.assertRaises(EmailDeliveryError):
                send_mail("Test", "Synthetic body", "sender@example.com", ["test@example.com"])
            self.assertEqual(post.call_count, 1)

    @override_settings(RESEND_API_KEY="")
    def test_missing_key_never_calls_provider_and_silent_mode_returns_zero(self):
        with patch("apps.users.email_delivery.requests.post") as post:
            with self.assertRaises(EmailDeliveryError):
                send_mail("Test", "Synthetic body", "sender@example.com", ["test@example.com"])
            self.assertEqual(send_mail("Test", "Synthetic body", "sender@example.com", ["test@example.com"], fail_silently=True), 0)
        post.assert_not_called()

    def test_non_delivering_production_backends_and_missing_smtp_host_are_rejected(self):
        for module in ("console", "filebased", "dummy"):
            with self.subTest(module=module), override_settings(EMAIL_BACKEND=f"django.core.mail.backends.{module}.EmailBackend"):
                with self.assertRaises(EmailDeliveryError):
                    ensure_email_delivery_configured()
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend", EMAIL_HOST=""):
            with self.assertRaises(EmailDeliveryError):
                ensure_email_delivery_configured()


@override_settings(
    EMAIL_BACKEND=RESEND_BACKEND, RESEND_API_KEY="re_test_only", DEBUG=False,
    LOGIN_CLIENT_IP_SOURCE="trusted-proxy", LOGIN_TRUSTED_PROXY_CIDRS=[],
)
class EmailDeliveryApiTests(APITestCase):
    def setUp(self):
        self.post = self.enterContext(patch("apps.users.email_delivery.requests.post", return_value=accepted_response()))
        self.registration = {
            "first_name": "Test", "last_name": "User", "email": "register@example.com",
            "phone_number": "+994507891234", "password": "SecurePass1",
            "password_confirm": "SecurePass1", "accept_terms": True,
        }

    def assertUnavailable(self, response):
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["code"], "email_delivery_unavailable")
        self.assertNotIn("re_test_only", str(response.data))
        self.assertNotIn("expires_at", response.data)

    def test_registration_reports_success_only_after_provider_acceptance(self):
        with patch("apps.users.verification.secrets.randbelow", return_value=4821):
            response = self.client.post(reverse("auth-register"), self.registration, format="json")
        self.assertEqual(response.status_code, 201)
        user = User.objects.get()
        self.assertFalse(user.is_active)
        self.assertTrue(check_password("4821", VerificationCode.objects.get().code_hash))
        self.assertIn("4821", self.post.call_args.kwargs["json"]["text"])
        self.assertNotIn("4821", str(response.data))

    @override_settings(RESEND_API_KEY="")
    def test_unconfigured_registration_returns_503_without_account_code_or_console_mail(self):
        output = StringIO()
        with redirect_stdout(output):
            response = self.client.post(reverse("auth-register"), self.registration, format="json")
        self.assertUnavailable(response)
        self.assertFalse(User.objects.exists())
        self.assertFalse(VerificationCode.objects.exists())
        self.post.assert_not_called()
        self.assertEqual(output.getvalue(), "")

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend")
    def test_explicit_console_configuration_does_not_print_production_otp(self):
        output = StringIO()
        with redirect_stdout(output):
            response = self.client.post(reverse("auth-register"), self.registration, format="json")
        self.assertUnavailable(response)
        self.assertEqual(output.getvalue(), "")
        self.assertFalse(User.objects.exists())

    @override_settings(RESEND_API_KEY="")
    def test_missing_configuration_has_same_response_for_known_and_unknown_reset_emails(self):
        for index, (route, extra) in enumerate((("auth-password-reset-request", {}),
                                               ("auth-verification-resend", {"purpose": "password_reset"}))):
            known = f"known{index}@example.com"
            User.objects.create_user(email=known, password="SecurePass1")
            responses = []
            for email in (known, f"unknown{index}@example.com"):
                response = self.client.post(reverse(route), {"email": email, **extra}, format="json")
                self.assertUnavailable(response)
                responses.append(response.data)
            self.assertEqual(responses[0], responses[1])
        self.post.assert_not_called()

    def test_provider_rejection_rolls_back_registration_and_returns_safe_error(self):
        self.post.return_value = Mock(status_code=403, text="private provider diagnostics")
        response = self.client.post(reverse("auth-register"), self.registration, format="json")
        self.assertUnavailable(response)
        self.assertFalse(User.objects.exists())
        self.assertFalse(VerificationCode.objects.exists())
        self.assertNotIn("private provider", str(response.data))

    def test_zero_accepted_messages_is_not_reported_as_success(self):
        with patch("apps.users.verification.send_mail", return_value=0):
            response = self.client.post(reverse("auth-register"), self.registration, format="json")
        self.assertUnavailable(response)
        self.assertFalse(User.objects.exists())
        self.assertFalse(VerificationCode.objects.exists())

    def test_failed_resend_preserves_the_previous_code(self):
        user = User.objects.create_user(email="pending@example.com", is_active=False)
        previous = issue_verification_code(user, VerificationCode.Purpose.REGISTRATION)
        VerificationCode.objects.filter(pk=previous.pk).update(created_at=timezone.now() - timedelta(seconds=61))
        self.post.return_value = Mock(status_code=429)
        response = self.client.post(reverse("auth-verification-resend"), {
            "email": user.email, "purpose": "registration",
        }, format="json")
        self.assertUnavailable(response)
        previous.refresh_from_db()
        self.assertIsNone(previous.consumed_at)
        self.assertEqual(VerificationCode.objects.count(), 1)
