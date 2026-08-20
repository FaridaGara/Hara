from unittest.mock import patch

from django.contrib import admin
from django.contrib.auth import get_user_model
import re

from django.core import mail
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from .admin import HaraUserAdmin
from .models import SocialIdentity
from .models import VerificationCode
from .social_auth import SocialClaims, SocialTokenError


User = get_user_model()


class UserManagerTests(TestCase):
    def test_create_user_with_email_and_password(self):
        user = User.objects.create_user(
            email="user@example.com",
            password="test-password-123",
        )

        self.assertEqual(user.email, "user@example.com")
        self.assertTrue(user.check_password("test-password-123"))
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)

    def test_default_account_type_is_user(self):
        user = User.objects.create_user(
            email="default@example.com",
            password="test-password-123",
        )

        self.assertEqual(user.account_type, User.AccountType.USER)
        self.assertEqual(user.role, "user")

    def test_create_organizer_user(self):
        user = User.objects.create_user(
            email="organizer@example.com",
            password="test-password-123",
            account_type=User.AccountType.ORGANIZER,
        )

        self.assertEqual(user.account_type, User.AccountType.ORGANIZER)
        self.assertFalse(user.is_staff)
        self.assertEqual(user.role, "organizer")

    def test_create_admin_user_enables_staff_with_scoped_permissions(self):
        user = User.objects.create_user(
            email="venue-admin@example.com",
            password="test-password-123",
            account_type=User.AccountType.ADMIN,
        )

        self.assertEqual(user.account_type, User.AccountType.ADMIN)
        self.assertTrue(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertEqual(user.role, "admin")

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
        self.assertEqual(user.account_type, User.AccountType.ADMIN)
        self.assertEqual(user.role, "superadmin")

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


class UserAdminPermissionTests(TestCase):
    def setUp(self):
        self.model_admin = HaraUserAdmin(User, admin.site)
        self.request = RequestFactory().get("/admin/users/user/")

    def test_regular_admin_cannot_manage_users_or_roles(self):
        self.request.user = User.objects.create_user(
            email="scoped-admin@example.com",
            password="test-password-123",
            account_type=User.AccountType.ADMIN,
        )

        self.assertFalse(self.model_admin.has_module_permission(self.request))
        self.assertFalse(self.model_admin.has_view_permission(self.request))
        self.assertFalse(self.model_admin.has_add_permission(self.request))
        self.assertFalse(self.model_admin.has_change_permission(self.request))
        self.assertFalse(self.model_admin.has_delete_permission(self.request))

    def test_superadmin_can_manage_users_and_roles(self):
        self.request.user = User.objects.create_superuser(
            email="root-admin@example.com",
            password="test-password-123",
        )

        self.assertTrue(self.model_admin.has_module_permission(self.request))
        self.assertTrue(self.model_admin.has_view_permission(self.request))
        self.assertTrue(self.model_admin.has_add_permission(self.request))
        self.assertTrue(self.model_admin.has_change_permission(self.request))
        self.assertTrue(self.model_admin.has_delete_permission(self.request))


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
                "nonce": "apple-request-nonce",
                "first_name": "Aysel",
                "last_name": "Məmmədova",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        verifier.assert_called_once_with(
            "apple-id-token",
            nonce="apple-request-nonce",
        )
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

    def test_apple_login_requires_nonce(self):
        response = self.client.post(
            reverse("auth-apple"),
            {"credential": "apple-id-token"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
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
        self.assertEqual(response.data["account_type"], "user")
        self.assertEqual(response.data["role"], "user")
        user.refresh_from_db()
        self.assertEqual(user.phone_number, "+994501112233")
        self.assertEqual(str(user.birth_date), "1996-11-12")
        self.assertEqual(user.interests, ["Musiqi", "Səyahət"])


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    AUTH_CODE_RESEND_COOLDOWN_SECONDS=60,
)
class CredentialsAccountFlowTests(APITestCase):
    registration_data = {
        "first_name": "Aysel",
        "last_name": "Məmmədova",
        "email": "aysel@example.com",
        "phone_number": "+994 50 111 22 33",
        "password": "SecurePass1",
        "password_confirm": "SecurePass1",
        "accept_terms": True,
    }

    def register(self):
        return self.client.post(
            reverse("auth-register"),
            self.registration_data,
            format="json",
        )

    def latest_code(self):
        match = re.search(r"(\d{4})", mail.outbox[-1].body)
        self.assertIsNotNone(match)
        return match.group(1)

    def test_registration_sends_hashed_code_and_verification_returns_session(self):
        response = self.register()

        self.assertEqual(response.status_code, 201)
        user = User.objects.get(email="aysel@example.com")
        self.assertFalse(user.is_active)
        self.assertFalse(user.is_email_verified)
        self.assertEqual(user.phone_number, "+994501112233")
        challenge = VerificationCode.objects.get(user=user)
        self.assertNotEqual(challenge.code_hash, self.latest_code())

        response = self.client.post(
            reverse("auth-verify-email"),
            {"email": user.email, "code": self.latest_code()},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        self.assertEqual(response.data["user"]["display_name"], "Aysel Məmmədova")
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertTrue(user.is_email_verified)

    def test_registration_rejects_weak_or_mismatched_passwords(self):
        weak = {**self.registration_data, "password": "lowercase1", "password_confirm": "different"}
        response = self.client.post(reverse("auth-register"), weak, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(User.objects.count(), 0)

    def test_registration_reserves_phone_for_pending_account(self):
        self.register()
        duplicate_phone = {
            **self.registration_data,
            "email": "other@example.com",
        }

        response = self.client.post(
            reverse("auth-register"),
            duplicate_phone,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("phone_number", response.data)

    def test_login_accepts_email_and_normalized_phone(self):
        user = User.objects.create_user(
            email="login@example.com",
            phone_number="+994501234567",
            password="SecurePass1",
        )
        for identifier in (user.email, "+994 50 123 45 67"):
            with self.subTest(identifier=identifier):
                response = self.client.post(
                    reverse("auth-login"),
                    {"identifier": identifier, "password": "SecurePass1"},
                    format="json",
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["user"]["email"], user.email)

    def test_password_reset_code_and_token_are_single_use(self):
        user = User.objects.create_user(
            email="reset@example.com",
            password="OldSecure1",
        )
        response = self.client.post(
            reverse("auth-password-reset-request"),
            {"email": user.email},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        code = self.latest_code()

        response = self.client.post(
            reverse("auth-password-reset-verify"),
            {"email": user.email, "code": code},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        token = response.data["reset_token"]

        payload = {
            "token": token,
            "password": "NewSecure2",
            "password_confirm": "NewSecure2",
        }
        response = self.client.post(
            reverse("auth-password-reset-confirm"),
            payload,
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password("NewSecure2"))

        second_response = self.client.post(
            reverse("auth-password-reset-confirm"),
            payload,
            format="json",
        )
        self.assertEqual(second_response.status_code, 400)

    def test_password_reset_does_not_reveal_unknown_email(self):
        response = self.client.post(
            reverse("auth-password-reset-request"),
            {"email": "missing@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    def test_password_reset_cooldown_does_not_reveal_known_email(self):
        User.objects.create_user(
            email="known@example.com",
            password="StrongPass1",
        )
        payload = {"email": "known@example.com"}
        first = self.client.post(
            reverse("auth-password-reset-request"),
            payload,
            format="json",
        )
        second = self.client.post(
            reverse("auth-password-reset-request"),
            payload,
            format="json",
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data, second.data)

    def test_password_reset_resend_does_not_reveal_known_email(self):
        user = User.objects.create_user(
            email="resend@example.com",
            password="StrongPass1",
        )
        self.client.post(
            reverse("auth-password-reset-request"),
            {"email": user.email},
            format="json",
        )
        known = self.client.post(
            reverse("auth-verification-resend"),
            {"email": user.email, "purpose": "password_reset"},
            format="json",
        )
        unknown = self.client.post(
            reverse("auth-verification-resend"),
            {"email": "missing@example.com", "purpose": "password_reset"},
            format="json",
        )

        self.assertEqual(known.status_code, 200)
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(known.data, unknown.data)
