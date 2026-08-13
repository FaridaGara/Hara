from django.db import transaction
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import SocialIdentity, User
from .serializers import SocialLoginSerializer, UserProfileSerializer
from .social_auth import SocialTokenError, verify_apple_token, verify_google_token


def token_payload(user):
    refresh = RefreshToken.for_user(user)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "user": UserProfileSerializer(user).data,
    }


@transaction.atomic
def resolve_social_user(provider, claims, supplied_first_name="", supplied_last_name=""):
    identity = (
        SocialIdentity.objects.select_related("user")
        .filter(provider=provider, subject=claims.subject)
        .first()
    )
    if identity:
        user = identity.user
    else:
        user = User.objects.filter(email=claims.email).first()
        if user and provider == SocialIdentity.Provider.GOOGLE and not claims.authoritative_email:
            raise SocialTokenError(
                "Bu email artıq mövcuddur. Əvvəl email və şifrə ilə daxil olun."
            )
        if not user:
            user = User.objects.create_user(email=claims.email)
        SocialIdentity.objects.create(
            user=user,
            provider=provider,
            subject=claims.subject,
        )

    first_name = claims.first_name or supplied_first_name.strip()
    last_name = claims.last_name or supplied_last_name.strip()
    display_name = claims.display_name or " ".join(
        value for value in (first_name, last_name) if value
    )
    changed_fields = []
    for field, value in (
        ("first_name", first_name),
        ("last_name", last_name),
        ("display_name", display_name),
        ("avatar_url", claims.avatar_url),
    ):
        if value and not getattr(user, field):
            setattr(user, field, value)
            changed_fields.append(field)
    if changed_fields:
        user.save(update_fields=changed_fields)
    return user


class BaseSocialLoginAPIView(APIView):
    permission_classes = [AllowAny]
    provider = None
    verifier = None

    def post(self, request):
        serializer = SocialLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            claims = self.verifier(serializer.validated_data["credential"])
            user = resolve_social_user(
                self.provider,
                claims,
                serializer.validated_data.get("first_name", ""),
                serializer.validated_data.get("last_name", ""),
            )
        except SocialTokenError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        return Response(token_payload(user))


class GoogleSocialLoginAPIView(BaseSocialLoginAPIView):
    provider = SocialIdentity.Provider.GOOGLE
    verifier = staticmethod(verify_google_token)


class AppleSocialLoginAPIView(BaseSocialLoginAPIView):
    provider = SocialIdentity.Provider.APPLE
    verifier = staticmethod(verify_apple_token)


class UserProfileAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserProfileSerializer(request.user).data)

    def patch(self, request):
        serializer = UserProfileSerializer(
            request.user,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
