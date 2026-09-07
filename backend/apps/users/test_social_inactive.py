from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import SocialIdentity
from .social_auth import SocialClaims


User = get_user_model()


class SocialAccountStatusTests(APITestCase):
    def social_login(self, provider, user, subject):
        view_name = {
            "google": "GoogleSocialLoginAPIView",
            "apple": "AppleSocialLoginAPIView",
        }[provider]
        claims = SocialClaims(
            subject=subject,
            email=user.email,
            email_verified=True,
            authoritative_email=True,
            first_name="Provider Name",
        )
        with patch(f"apps.users.views.{view_name}.verifier", return_value=claims):
            return self.client.post(
                reverse(f"auth-{provider}"),
                {"credential": "test-provider-token", "nonce": "test-nonce"},
                format="json",
            )

    def test_inactive_accounts_are_denied_without_mutation(self):
        for provider in ("google", "apple"):
            for linked in (False, True):
                for verified in (False, True):
                    with self.subTest(provider=provider, linked=linked, verified=verified):
                        subject = f"inactive-{provider}-{linked}-{verified}"
                        user = User.objects.create_user(
                            email=f"{subject}@example.com",
                            password="SecurePass1",
                            is_active=False,
                            is_email_verified=verified,
                        )
                        if linked:
                            SocialIdentity.objects.create(
                                user=user, provider=provider, subject=subject,
                            )
                        original_user = User.objects.filter(pk=user.pk).values().get()
                        original_identities = list(
                            SocialIdentity.objects.filter(user=user).values()
                        )

                        response = self.social_login(provider, user, subject)

                        self.assertEqual(response.status_code, 401)
                        self.assertNotIn("access", response.data)
                        self.assertNotIn("refresh", response.data)
                        self.assertEqual(
                            User.objects.filter(pk=user.pk).values().get(), original_user,
                        )
                        self.assertEqual(
                            list(SocialIdentity.objects.filter(user=user).values()),
                            original_identities,
                        )

    def test_active_accounts_can_link_and_log_in(self):
        for provider in ("google", "apple"):
            for linked in (False, True):
                with self.subTest(provider=provider, linked=linked):
                    subject = f"active-{provider}-{linked}"
                    user = User.objects.create_user(
                        email=f"{subject}@example.com", password="SecurePass1",
                    )
                    if linked:
                        SocialIdentity.objects.create(
                            user=user, provider=provider, subject=subject,
                        )

                    response = self.social_login(provider, user, subject)

                    self.assertEqual(response.status_code, 200)
                    self.assertIn("access", response.data)
                    self.assertIn("refresh", response.data)
                    self.assertEqual(response.data["user"]["id"], user.pk)
                    self.assertEqual(
                        SocialIdentity.objects.filter(
                            user=user, provider=provider, subject=subject,
                        ).count(),
                        1,
                    )
