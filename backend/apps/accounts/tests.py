import unittest

from django.apps import apps


if not apps.is_installed("apps.accounts"):
    raise unittest.SkipTest(
        "Legacy apps.accounts is not installed; apps.users is authoritative."
    )


from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.exceptions import FieldDoesNotExist
from django.db import IntegrityError, transaction
from django.test import TestCase

from .admin import AccountsUserAdmin


User = get_user_model()


class UserModelTests(TestCase):
    def test_create_user(self):
        user = User.objects.create_user(
            email="person@EXAMPLE.COM",
            password="test-password-123",
            first_name="Hara",
            last_name="User",
            phone_number="+994501234567",
        )

        self.assertEqual(user.email, "person@example.com")
        self.assertEqual(user.first_name, "Hara")
        self.assertEqual(user.last_name, "User")
        self.assertEqual(user.phone_number, "+994501234567")
        self.assertTrue(user.check_password("test-password-123"))
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertIsNotNone(user.created_at)
        self.assertIsNotNone(user.updated_at)

    def test_create_superuser(self):
        user = User.objects.create_superuser(
            email="admin@example.com",
            password="admin-password-123",
        )

        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.is_active)

    def test_email_must_be_unique(self):
        User.objects.create_user(
            email="unique@example.com",
            password="test-password-123",
        )

        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create_user(
                email="unique@example.com",
                password="another-password-123",
            )

    def test_email_is_the_login_identifier(self):
        self.assertEqual(User.USERNAME_FIELD, "email")
        self.assertEqual(User.REQUIRED_FIELDS, [])

        with self.assertRaises(FieldDoesNotExist):
            User._meta.get_field("username")

    def test_user_is_registered_with_custom_admin(self):
        self.assertIn(User, admin.site._registry)
        self.assertIsInstance(admin.site._registry[User], AccountsUserAdmin)
