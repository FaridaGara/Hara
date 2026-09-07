from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from io import StringIO

from django.core.management import call_command
from drf_spectacular.generators import SchemaGenerator

from django.db import close_old_connections
from django.test import TransactionTestCase, skipUnlessDBFeature
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AuthSession, User
from .sessions import issue_session, revoke_session, rotate_session


class SessionTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="session@example.com", password="SecurePass1")
        response = self.client.post(reverse("auth-login"), {
            "identifier": self.user.email, "password": "SecurePass1",
        }, format="json")
        self.assertEqual(response.status_code, 200)
        self.tokens = response.data

    def refresh(self, token):
        return self.client.post(reverse("auth-refresh"), {"refresh": token}, format="json")

    def logout(self, token):
        return self.client.post(reverse("auth-logout"), {"refresh": token}, format="json")

    def profile(self, access):
        return self.client.get(reverse("auth-profile"), HTTP_AUTHORIZATION=f"Bearer {access}")

    def test_login_issues_session_and_rotation_is_single_use(self):
        original = RefreshToken(self.tokens["refresh"])
        self.assertTrue(AuthSession.objects.filter(pk=original["sid"], user=self.user).exists())
        self.assertEqual(self.profile(self.tokens["access"]).status_code, 200)
        response = self.refresh(self.tokens["refresh"])
        self.assertEqual(response.status_code, 200)
        rotated = RefreshToken(response.data["refresh"])
        self.assertNotEqual(rotated["jti"], original["jti"])
        self.assertEqual(rotated["sid"], original["sid"])
        self.assertEqual(rotated["exp"], original["exp"])
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, 401)
        self.assertEqual(self.refresh(response.data["refresh"]).status_code, 200)

    def test_logout_revokes_access_and_refresh_and_is_idempotent(self):
        self.assertEqual(self.logout(self.tokens["refresh"]).status_code, 204)
        self.assertEqual(self.logout(self.tokens["refresh"]).status_code, 204)
        self.assertEqual(self.profile(self.tokens["access"]).status_code, 401)
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, 401)

    def test_old_refresh_can_logout_rotated_session_without_affecting_other_device(self):
        other = issue_session(self.user)
        rotated = self.refresh(self.tokens["refresh"]).data
        self.assertEqual(self.logout(self.tokens["refresh"]).status_code, 204)
        self.assertEqual(self.refresh(rotated["refresh"]).status_code, 401)
        self.assertEqual(self.profile(rotated["access"]).status_code, 401)
        self.assertEqual(self.profile(other["access"]).status_code, 200)
        self.assertEqual(self.refresh(other["refresh"]).status_code, 200)

    def test_password_change_revokes_access_and_refresh(self):
        self.user.set_password("NewSecurePass2")
        self.user.save()
        self.assertEqual(self.profile(self.tokens["access"]).status_code, 401)
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, 401)

    def test_inactive_user_cannot_refresh_or_use_access(self):
        self.user.is_active = False
        self.user.save()
        self.assertEqual(self.profile(self.tokens["access"]).status_code, 401)
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, 401)

    def test_expired_session_rejects_both_tokens(self):
        AuthSession.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.profile(self.tokens["access"]).status_code, 401)
        self.assertEqual(self.refresh(self.tokens["refresh"]).status_code, 401)

    def test_legacy_and_invalid_tokens_do_not_create_sessions(self):
        legacy = RefreshToken.for_user(self.user)
        for token in (str(legacy), "not-a-token", self.tokens["access"]):
            with self.subTest(token_type="legacy-or-invalid"):
                self.assertEqual(self.refresh(token).status_code, 401)
                self.assertEqual(self.logout(token).status_code, 401)
        self.assertEqual(self.profile(str(legacy.access_token)).status_code, 401)
        self.assertEqual(AuthSession.objects.count(), 1)

    def test_signed_token_with_invalid_session_id_is_rejected(self):
        token = RefreshToken(self.tokens["refresh"])
        token["sid"] = "not-a-uuid"
        self.assertEqual(self.refresh(str(token)).status_code, 401)
        self.assertEqual(self.logout(str(token)).status_code, 401)

    def test_logout_rejects_token_tampering(self):
        token = self.tokens["refresh"]
        header, payload, signature = token.split(".")
        tampered = f"{header}.{payload}.{'A' if signature[0] != 'A' else 'B'}{signature[1:]}"
        self.assertEqual(self.logout(tampered).status_code, 401)
        self.assertEqual(self.profile(self.tokens["access"]).status_code, 200)


    def test_cleanup_preserves_unexpired_and_recently_expired_sessions(self):
        old = issue_session(self.user)
        recent = issue_session(self.user)
        AuthSession.objects.filter(pk=RefreshToken(old["refresh"])["sid"]).update(
            expires_at=timezone.now() - timedelta(days=2),
        )
        AuthSession.objects.filter(pk=RefreshToken(recent["refresh"])["sid"]).update(
            expires_at=timezone.now() - timedelta(hours=1),
        )
        call_command("prune_auth_sessions", stdout=StringIO())
        self.assertEqual(AuthSession.objects.count(), 2)
        self.assertEqual(self.profile(self.tokens["access"]).status_code, 200)

    def test_openapi_keeps_bearer_auth_and_documents_rotation(self):
        schema = SchemaGenerator().get_schema(public=True)
        self.assertEqual(schema["components"]["securitySchemes"]["jwtAuth"]["scheme"], "bearer")
        self.assertIn({"jwtAuth": []}, schema["paths"][reverse("auth-profile")]["get"]["security"])
        self.assertIn("refresh", schema["components"]["schemas"]["RotatedSession"]["properties"])
        self.assertIn("204", schema["paths"][reverse("auth-logout")]["post"]["responses"])


class SessionConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_parallel_refresh_allows_only_one_rotation(self):
        user = User.objects.create_user(email="parallel@example.com", password="SecurePass1")
        token = issue_session(user)["refresh"]
        barrier = Barrier(2)

        def rotate(_):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                try:
                    return rotate_session(token)
                except InvalidToken:
                    return None
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(rotate, range(2)))
        self.assertEqual(sum(result is not None for result in results), 1)

    @skipUnlessDBFeature("has_select_for_update")
    def test_logout_wins_against_concurrent_refresh(self):
        user = User.objects.create_user(email="logout-race@example.com", password="SecurePass1")
        token = issue_session(user)["refresh"]
        barrier = Barrier(2)

        def operate(action):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                try:
                    return action(token)
                except InvalidToken:
                    return None
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(operate, (rotate_session, revoke_session)))
        self.assertIsNotNone(AuthSession.objects.get().revoked_at)
        with self.assertRaises(InvalidToken):
            rotate_session(token)
        if results[0]:
            with self.assertRaises(InvalidToken):
                rotate_session(results[0]["refresh"])
