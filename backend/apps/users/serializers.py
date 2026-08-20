import re

from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import User


PHONE_PATTERN = re.compile(r"^\+994\d{9}$")


def normalize_phone(value):
    return re.sub(r"[\s()\-]", "", value.strip())


def validate_new_password(password, *, user=None):
    errors = []
    if not re.search(r"[A-ZƏÖÜİÇŞĞ]", password):
        errors.append("Şifrədə ən azı bir böyük hərf olmalıdır.")
    if not re.search(r"\d", password):
        errors.append("Şifrədə ən azı bir rəqəm olmalıdır.")
    try:
        password_validation.validate_password(password, user=user)
    except DjangoValidationError as exc:
        errors.extend(exc.messages)
    if errors:
        raise serializers.ValidationError(errors)
    return password


class UserProfileSerializer(serializers.ModelSerializer):
    providers = serializers.SerializerMethodField()
    role = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "email",
            "display_name",
            "first_name",
            "last_name",
            "phone_number",
            "avatar_url",
            "birth_date",
            "interests",
            "account_type",
            "role",
            "providers",
            "is_email_verified",
        )
        read_only_fields = (
            "id",
            "email",
            "account_type",
            "role",
            "providers",
            "is_email_verified",
        )

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_providers(self, obj):
        return list(
            obj.social_identities.order_by("provider")
            .values_list("provider", flat=True)
        )

    def validate_interests(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Maraqlar siyahı formatında olmalıdır.")

        interests = []
        for item in value:
            if not isinstance(item, str):
                raise serializers.ValidationError("Hər maraq mətn olmalıdır.")
            normalized = item.strip()
            if not normalized or len(normalized) > 50:
                raise serializers.ValidationError("Maraq adı 1–50 simvol olmalıdır.")
            if normalized not in interests:
                interests.append(normalized)
        if len(interests) > 12:
            raise serializers.ValidationError("Ən çox 12 maraq seçilə bilər.")
        return interests


class SocialLoginSerializer(serializers.Serializer):
    credential = serializers.CharField(trim_whitespace=False)
    nonce = serializers.CharField(
        required=False,
        allow_blank=True,
        trim_whitespace=False,
        max_length=128,
    )
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150)


class CredentialsLoginSerializer(serializers.Serializer):
    identifier = serializers.CharField(max_length=254)
    password = serializers.CharField(trim_whitespace=False)

    def validate(self, attrs):
        identifier = attrs["identifier"].strip()
        if "@" in identifier:
            user = User.objects.filter(email=identifier.casefold()).first()
        else:
            phone = normalize_phone(identifier)
            users = User.objects.filter(phone_number=phone, is_active=True)[:2]
            user = users[0] if len(users) == 1 else None

        if not user or not user.is_active or not user.check_password(attrs["password"]):
            raise serializers.ValidationError(
                "E-poçt, telefon və ya şifrə yanlışdır."
            )
        attrs["user"] = user
        return attrs


class RegistrationSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField(max_length=254)
    phone_number = serializers.CharField(max_length=32)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    password_confirm = serializers.CharField(write_only=True, trim_whitespace=False)
    accept_terms = serializers.BooleanField(write_only=True)

    def validate_email(self, value):
        return value.strip().casefold()

    def validate_phone_number(self, value):
        phone = normalize_phone(value)
        if not PHONE_PATTERN.fullmatch(phone):
            raise serializers.ValidationError(
                "Telefonu +994501112233 formatında daxil edin."
            )
        return phone

    def validate(self, attrs):
        existing = User.objects.filter(email=attrs["email"]).first()
        if existing and existing.is_active:
            raise serializers.ValidationError(
                {"email": "Bu e-poçtla artıq hesab mövcuddur."}
            )
        phone_users = User.objects.filter(phone_number=attrs["phone_number"])
        if existing:
            phone_users = phone_users.exclude(pk=existing.pk)
        if phone_users.exists():
            raise serializers.ValidationError(
                {"phone_number": "Bu telefon nömrəsi artıq istifadə olunur."}
            )
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError(
                {"password_confirm": "Şifrələr eyni deyil."}
            )
        if not attrs["accept_terms"]:
            raise serializers.ValidationError(
                {"accept_terms": "Şərtləri qəbul etməlisiniz."}
            )
        validate_new_password(attrs["password"], user=existing)
        attrs["existing_user"] = existing
        return attrs

    def create(self, validated_data):
        existing = validated_data.pop("existing_user", None)
        validated_data.pop("password_confirm")
        validated_data.pop("accept_terms")
        password = validated_data.pop("password")
        display_name = " ".join(
            (validated_data["first_name"], validated_data["last_name"])
        ).strip()
        if existing:
            for field, value in validated_data.items():
                setattr(existing, field, value)
            existing.display_name = display_name
            existing.is_email_verified = False
            existing.set_password(password)
            existing.save()
            return existing
        return User.objects.create_user(
            password=password,
            display_name=display_name,
            is_active=False,
            is_email_verified=False,
            **validated_data,
        )


class VerificationCodeSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    code = serializers.RegexField(r"^\d{4}$")

    def validate_email(self, value):
        return value.strip().casefold()


class VerificationResendSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    purpose = serializers.ChoiceField(choices=("registration", "password_reset"))

    def validate_email(self, value):
        return value.strip().casefold()


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)

    def validate_email(self, value):
        return value.strip().casefold()


class PasswordResetConfirmSerializer(serializers.Serializer):
    token = serializers.CharField(trim_whitespace=False)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    password_confirm = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError(
                {"password_confirm": "Şifrələr eyni deyil."}
            )
        validate_new_password(attrs["password"])
        return attrs
