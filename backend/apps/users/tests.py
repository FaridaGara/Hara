from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import SocialIdentity
from .social_auth import SocialClaims, SocialTokenError


User = get_user_model()


class UserManagerTests(TestCase):
    def test_create_attendee_user_with_email_and_password(self):
        user = User.objects.create_user(
            email="attendee@example.com",
            password="test-password-123",
        )

        self.assertEqual(user.email, "attendee@example.com")
        self.assertTrue(user.check_password("test-password-123"))
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)

    def test_default_account_type_is_attendee(self):
        user = User.objects.create_user(
            email="default@example.com",
            password="test-password-123",
        )

        self.assertEqual(user.account_type, User.AccountType.ATTENDEE)

    def test_create_organizer_user(self):
        user = User.objects.create_user(
            email="organizer@example.com",
            password="test-password-123",
            account_type=User.AccountType.ORGANIZER,
        )

        self.assertEqual(user.account_type, User.AccountType.ORGANIZER)

    def test_email_is_normalized(self):
        user = User.objects.create_user(
            email="Person@EXAMPLE.COM",
            password="test-password-123",
        )

        self.assertEqual(user.email, "person@example.com")

    def test_duplicate_email_is_rejected(self):
        User.objects.create_user(
            email="duplicate@example.com",
            password="test-password-123",
        )

        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create_user(
                email="duplicate@example.com",
                password="different-password-123",
            )

    def test_password_is_hashed(self):
        raw_password = "test-password-123"
        user = User.objects.create_user(
            email="password@example.com",
            password=raw_password,
        )

        self.assertNotEqual(user.password, raw_password)
        self.assertTrue(user.check_password(raw_password))

    def test_create_superuser(self):
        user = User.objects.create_superuser(
            email="admin@example.com",
            password="admin-password-123",
        )

        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)
        self.assertEqual(user.account_type, User.AccountType.ATTENDEE)

    def test_invalid_superuser_flags_raise_errors(self):
        invalid_fields = (
            {"is_staff": False},
            {"is_superuser": False},
        )

        for extra_fields in invalid_fields:
            with self.subTest(extra_fields=extra_fields):
                with self.assertRaises(ValueError):
                    User.objects.create_superuser(
                        email=f"admin-{len(extra_fields)}@example.com",
                        password="admin-password-123",
                        **extra_fields,
                    )

    def test_invalid_email_is_rejected(self):
        with self.assertRaises(ValidationError):
            User.objects.create_user(
                email="not-an-email",
                password="test-password-123",
            )


class SocialLoginTests(APITestCase):
    @patch("apps.users.views.GoogleSocialLoginAPIView.verifier")
    def test_google_login_creates_profile_and_returns_hara_tokens(self, verifier):
        verifier.return_value = SocialClaims(
            subject="google-user-123",
            email="monika@gmail.com",
            email_verified=True,
            first_name="Monika",
            last_name="Aliyeva",
            display_name="Monika Aliyeva",
            avatar_url="https://images.example.com/monika.jpg",
            authoritative_email=True,
        )
        response = self.client.post(
            reverse("auth-google"),
            {"credential": "google-id-token"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        self.assertEqual(response.data["user"]["display_name"], "Monika Aliyeva")
        user = User.objects.get(email="monika@gmail.com")
        self.assertEqual(user.avatar_url, "https://images.example.com/monika.jpg")
        self.assertTrue(
            SocialIdentity.objects.filter(
                user=user,
                provider="google",
                subject="google-user-123",
            ).exists()
        )

    @patch("apps.users.views.AppleSocialLoginAPIView.verifier")
    def test_apple_first_login_persists_name_returned_once(self, verifier):
        verifier.return_value = SocialClaims(
            subject="apple-user-123",
            email="relay@privaterelay.appleid.com",
            email_verified=True,
            authoritative_email=True,
        )
        response = self.client.post(
            reverse("auth-apple"),
            {
                "credential": "apple-id-token",
                "first_name": "Aysel",
                "last_name": "Məmmədova",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user"]["display_name"], "Aysel Məmmədova")
        user = User.objects.get(email="relay@privaterelay.appleid.com")
        self.assertEqual(user.first_name, "Aysel")
        self.assertEqual(user.last_name, "Məmmədova")

    @patch("apps.users.views.GoogleSocialLoginAPIView.verifier")
    def test_invalid_social_token_does_not_create_user(self, verifier):
        verifier.side_effect = SocialTokenError("Token invalid.")
        response = self.client.post(
            reverse("auth-google"),
            {"credential": "bad-token"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(User.objects.count(), 0)

    def test_profile_endpoint_returns_and_updates_authenticated_user(self):
        user = User.objects.create_user(
            email="profile@example.com",
            password="secret-password",
            display_name="Old Name",
        )
        self.client.force_authenticate(user)
        response = self.client.patch(
            reverse("auth-profile"),
            {
                "display_name": "New Name",
                "phone_number": "+994501112233",
                "birth_date": "1996-11-12",
                "interests": ["Musiqi", "Səyahət", "Musiqi"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["display_name"], "New Name")
        user.refresh_from_db()
        self.assertEqual(user.phone_number, "+994501112233")
        self.assertEqual(str(user.birth_date), "1996-11-12")
        self.assertEqual(user.interests, ["Musiqi", "Səyahət"])
