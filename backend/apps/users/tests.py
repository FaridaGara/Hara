from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase


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
