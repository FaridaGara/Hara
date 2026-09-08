from django.conf import settings
from django.db import transaction
from drf_spectacular.utils import extend_schema, extend_schema_view, inline_serializer
from rest_framework import serializers as drf_serializers
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .sessions import issue_session
from .models import SocialIdentity, User
from .models import VerificationCode
from .serializers import (
    CredentialsLoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegistrationSerializer,
    SocialLoginSerializer,
    UserProfileSerializer,
    VerificationCodeSerializer,
    VerificationResendSerializer,
)
from .social_auth import SocialTokenError, verify_apple_token, verify_google_token
from .throttles import (
    CredentialsLoginThrottle, LoginThrottled, SocialLoginThrottle,
    VerificationAttemptThrottle, VerificationAttemptThrottled,
    VerificationSendThrottle, VerificationSendThrottled,
)
from .verification import (
    VerificationError,
    VerificationRateLimited,
    consume_password_reset_token,
    create_password_reset_token,
    issue_verification_code,
    verify_challenge,
)


AUTH_SESSION_SCHEMA = inline_serializer(
    name="AuthSession",
    fields={
        "access": drf_serializers.CharField(),
        "refresh": drf_serializers.CharField(),
        "user": UserProfileSerializer(),
    },
)
AUTH_DELIVERY_SCHEMA = inline_serializer(
    name="AuthDelivery",
    fields={
        "detail": drf_serializers.CharField(),
        "email": drf_serializers.EmailField(required=False),
        "expires_at": drf_serializers.DateTimeField(required=False),
        "retry_after": drf_serializers.IntegerField(required=False),
    },
)
PASSWORD_RESET_TOKEN_SCHEMA = inline_serializer(
    name="PasswordResetToken",
    fields={"reset_token": drf_serializers.CharField()},
)
LOGIN_RATE_LIMITED_SCHEMA = inline_serializer(
    name="LoginRateLimited",
    fields={
        "detail": drf_serializers.CharField(),
        "retry_after": drf_serializers.IntegerField(),
    },
)
VERIFICATION_ATTEMPT_LIMITED_SCHEMA = inline_serializer(
    name="VerificationAttemptRateLimited",
    fields={
        "detail": drf_serializers.CharField(),
        "retry_after": drf_serializers.IntegerField(),
    },
)


def token_payload(user):
    return {
        **issue_session(user),
        "user": UserProfileSerializer(user).data,
    }


@transaction.atomic
def resolve_social_user(provider, claims, supplied_first_name="", supplied_last_name=""):
    identity = (
        SocialIdentity.objects.select_related("user")
        .filter(provider=provider, subject=claims.subject)
        .first()
    )
    user = identity.user if identity else User.objects.filter(email=claims.email).first()
    # Provider email verification must not override the local account status.
    # Check before linking an identity, updating the profile, or issuing tokens.
    if user and not user.is_active:
        raise SocialTokenError("Bu hesabla giriş mümkün deyil.")

    if not identity:
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
        ("is_email_verified", claims.email_verified),
    ):
        if value and not getattr(user, field):
            setattr(user, field, value)
            changed_fields.append(field)
    if changed_fields:
        user.save(update_fields=changed_fields)
    return user


def verification_error_response(exc):
    if isinstance(exc, VerificationRateLimited):
        return Response(
            {"detail": str(exc), "retry_after": exc.retry_after},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
            headers={"Retry-After": str(exc.retry_after)},
        )
    return Response(
        {"detail": str(exc)},
        status=status.HTTP_400_BAD_REQUEST,
    )


@extend_schema_view(
    post=extend_schema(
        auth=[],
        request=CredentialsLoginSerializer,
        responses={
            200: AUTH_SESSION_SCHEMA,
            429: LOGIN_RATE_LIMITED_SCHEMA,
        },
    )
)
class CredentialsLoginAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [CredentialsLoginThrottle]

    def throttled(self, request, wait):
        raise LoginThrottled(wait)

    def post(self, request):
        serializer = CredentialsLoginSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {"detail": "E-poçt, telefon və ya şifrə yanlışdır."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        return Response(token_payload(serializer.validated_data["user"]))


class VerificationSendAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [VerificationSendThrottle]

    def throttled(self, request, wait):
        raise VerificationSendThrottled(wait)


@extend_schema_view(
    post=extend_schema(
        auth=[],
        request=RegistrationSerializer,
        responses={201: AUTH_DELIVERY_SCHEMA, 429: AUTH_DELIVERY_SCHEMA},
    )
)
class RegistrationAPIView(VerificationSendAPIView):

    def post(self, request):
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            # Throttle reservations commit before account/code transactions.
            with transaction.atomic():
                user = serializer.save()
                challenge = issue_verification_code(user, VerificationCode.Purpose.REGISTRATION)
        except VerificationError as exc:
            return verification_error_response(exc)
        return Response(
            {
                "detail": "Təsdiqləmə kodu e-poçtunuza göndərildi.",
                "email": user.email,
                "expires_at": challenge.expires_at,
                "retry_after": settings.AUTH_CODE_RESEND_COOLDOWN_SECONDS,
            },
            status=status.HTTP_201_CREATED,
        )


class VerificationAttemptAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [VerificationAttemptThrottle]

    def throttled(self, request, wait):
        raise VerificationAttemptThrottled(wait)


@extend_schema_view(
    post=extend_schema(
        auth=[],
        request=VerificationCodeSerializer,
        responses={200: AUTH_SESSION_SCHEMA, 429: VERIFICATION_ATTEMPT_LIMITED_SCHEMA},
    )
)
class EmailVerificationAPIView(VerificationAttemptAPIView):

    @transaction.atomic
    def post(self, request):
        serializer = VerificationCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(
            email=serializer.validated_data["email"],
            is_active=False,
        ).first()
        if not user:
            return Response(
                {"detail": "Təsdiqləmə sorğusu tapılmadı."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            verify_challenge(
                user,
                VerificationCode.Purpose.REGISTRATION,
                serializer.validated_data["code"],
                consume=True,
            )
        except VerificationError as exc:
            return verification_error_response(exc)
        user.is_active = True
        user.is_email_verified = True
        user.save(update_fields=("is_active", "is_email_verified"))
        return Response(token_payload(user))


@extend_schema_view(
    post=extend_schema(
        auth=[],
        request=VerificationResendSerializer,
        responses={200: AUTH_DELIVERY_SCHEMA, 429: AUTH_DELIVERY_SCHEMA},
    )
)
class VerificationResendAPIView(VerificationSendAPIView):

    def post(self, request):
        serializer = VerificationResendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        purpose = serializer.validated_data["purpose"]
        generic_reset_response = {
            "detail": "Uyğun hesab varsa, yeni kod e-poçta göndərildi.",
            "retry_after": settings.AUTH_CODE_RESEND_COOLDOWN_SECONDS,
        }
        user_query = User.objects.filter(email=serializer.validated_data["email"])
        if purpose == VerificationCode.Purpose.REGISTRATION:
            user_query = user_query.filter(is_active=False)
        else:
            user_query = user_query.filter(is_active=True)
        user = user_query.first()
        if not user:
            return Response(generic_reset_response)
        try:
            issue_verification_code(user, purpose)
        except VerificationError as exc:
            if purpose == VerificationCode.Purpose.PASSWORD_RESET:
                return Response(generic_reset_response)
            return verification_error_response(exc)
        if purpose == VerificationCode.Purpose.PASSWORD_RESET:
            return Response(generic_reset_response)
        return Response({
            "detail": "Yeni kod e-poçtunuza göndərildi.",
            "retry_after": settings.AUTH_CODE_RESEND_COOLDOWN_SECONDS,
        })


@extend_schema_view(
    post=extend_schema(
        auth=[],
        request=PasswordResetRequestSerializer,
        responses={200: AUTH_DELIVERY_SCHEMA, 429: AUTH_DELIVERY_SCHEMA},
    )
)
class PasswordResetRequestAPIView(VerificationSendAPIView):

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(
            email=serializer.validated_data["email"],
            is_active=True,
        ).first()
        if user:
            try:
                issue_verification_code(
                    user,
                    VerificationCode.Purpose.PASSWORD_RESET,
                )
            except VerificationRateLimited:
                # Keep this response identical to the unknown-email case.
                pass
        return Response(
            {
                "detail": "Uyğun hesab varsa, bərpa kodu e-poçta göndərildi.",
                "retry_after": settings.AUTH_CODE_RESEND_COOLDOWN_SECONDS,
            }
        )


@extend_schema_view(
    post=extend_schema(
        auth=[],
        request=VerificationCodeSerializer,
        responses={200: PASSWORD_RESET_TOKEN_SCHEMA, 429: VERIFICATION_ATTEMPT_LIMITED_SCHEMA},
    )
)
class PasswordResetVerifyAPIView(VerificationAttemptAPIView):

    def post(self, request):
        serializer = VerificationCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(
            email=serializer.validated_data["email"],
            is_active=True,
        ).first()
        if not user:
            return Response(
                {"detail": "Kod etibarsızdır və ya vaxtı bitib."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            challenge = verify_challenge(
                user,
                VerificationCode.Purpose.PASSWORD_RESET,
                serializer.validated_data["code"],
                consume=False,
            )
        except VerificationError as exc:
            return verification_error_response(exc)
        return Response(
            {"reset_token": create_password_reset_token(challenge)}
        )


@extend_schema_view(
    post=extend_schema(
        auth=[],
        request=PasswordResetConfirmSerializer,
        responses={200: AUTH_DELIVERY_SCHEMA, 429: VERIFICATION_ATTEMPT_LIMITED_SCHEMA},
    )
)
class PasswordResetConfirmAPIView(VerificationAttemptAPIView):

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            consume_password_reset_token(
                serializer.validated_data["token"],
                serializer.validated_data["password"],
            )
        except VerificationError as exc:
            return verification_error_response(exc)
        return Response({"detail": "Şifrəniz uğurla yeniləndi."})


@extend_schema_view(
    post=extend_schema(
        auth=[],
        request=SocialLoginSerializer,
        responses={200: AUTH_SESSION_SCHEMA, 429: LOGIN_RATE_LIMITED_SCHEMA},
    )
)
class BaseSocialLoginAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [SocialLoginThrottle]
    provider = None
    verifier = None

    def throttled(self, request, wait):
        raise LoginThrottled(wait)

    def post(self, request):
        serializer = SocialLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        nonce = serializer.validated_data.get("nonce", "")
        if self.provider == SocialIdentity.Provider.APPLE and not nonce:
            return Response(
                {"detail": "Apple giriş sorğusu etibarsızdır."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            claims = self.verifier(
                serializer.validated_data["credential"],
                nonce=nonce,
            )
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


@extend_schema_view(
    get=extend_schema(responses={200: UserProfileSerializer}),
    patch=extend_schema(
        request=UserProfileSerializer,
        responses={200: UserProfileSerializer},
    ),
)
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
