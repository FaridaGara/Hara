import re

from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import User
from .login_identifiers import find_login_user, normalize_phone


PHONE_PATTERN = re.compile(r"^\+994(?:10|50|51|55|60|70|77|99)[0-9]{7}$")


def validate_new_password(password, *, user=None):
    errors = []
    if not re.search(r"[A-ZƏÖÜİÇŞĞ]", password):
        errors.append("Şifrədə ən azı bir böyük hərf olmalıdır.")
    if not re.search(r"\d", password):
        errors.append("Şifrədə ən azı bir rəqəm olmalıdır.")
    try:
        password_validation.validate_password(password, user=user)
    except DjangoValidationError as exc:
        messages = {
            "password_too_short": "Şifrə ən azı 8 simvoldan ibarət olmalıdır.",
            "password_too_common": "Bu şifrə çox istifadə olunur. Daha güclü şifrə seçin.",
            "password_entirely_numeric": "Şifrə yalnız rəqəmlərdən ibarət ola bilməz.",
            "password_too_similar": "Şifrə şəxsi məlumatlarınıza çox bənzəyir. Başqa şifrə seçin.",
        }
        errors.extend(messages.get(error.code, "Şifrə təhlükəsizlik tələblərinə uyğun deyil. Başqa şifrə seçin.") for error in exc.error_list)
    if errors:
        raise serializers.ValidationError(errors)
    return password


class UserProfileSerializer(serializers.ModelSerializer):
    providers = serializers.SerializerMethodField()
    role = serializers.CharField(read_only=True)
    can_review_events = serializers.SerializerMethodField()
    can_moderate_events = serializers.SerializerMethodField()

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
            "organizer_name", "organizer_description", "organizer_website",
            "tax_id", "tax_legal_name",
            "birth_date",
            "interests",
            "account_type",
            "role",
            "providers",
            "is_email_verified",
            "can_review_events",
            "can_moderate_events",
        )
        read_only_fields = (
            "id",
            "email",
            "account_type",
            "role",
            "providers",
            "is_email_verified",
            "can_review_events",
            "can_moderate_events",
        )

    def validate_organizer_website(self, value):
        if value and not value.lower().startswith(("https://", "http://")):
            raise serializers.ValidationError("HTTP və ya HTTPS linki daxil et.")
        return value

    def validate(self, attrs):
        organizer_fields = ("organizer_name", "organizer_description", "organizer_website", "tax_id", "tax_legal_name")
        if any(key in attrs for key in organizer_fields):
            errors = {}
            for key in ("display_name", "phone_number", "organizer_name", "organizer_description", "tax_id", "tax_legal_name"):
                value = attrs.get(key, getattr(self.instance, key, ""))
                if not value.strip():
                    errors[key] = "Bu sahə məcburidir."
            tax_id = attrs.get("tax_id", getattr(self.instance, "tax_id", ""))
            if tax_id and not re.fullmatch(r"[0-9]{10}", tax_id):
                errors["tax_id"] = "VÖEN 10 rəqəmdən ibarət olmalıdır."
            phone = normalize_phone(attrs.get("phone_number", getattr(self.instance, "phone_number", "")))
            if not PHONE_PATTERN.fullmatch(phone):
                errors["phone_number"] = "+994 ölkə kodundan sonra 9 rəqəm daxil et."
            else:
                attrs["phone_number"] = phone
            if errors:
                raise serializers.ValidationError(errors)
        return attrs

    @extend_schema_field(serializers.BooleanField())
    def get_can_review_events(self, obj):
        from events.permissions import can_review_events
        return can_review_events(obj)

    @extend_schema_field(serializers.BooleanField())
    def get_can_moderate_events(self, obj):
        from events.permissions import can_review_events
        return can_review_events(obj, change=True)

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
    credential = serializers.CharField(trim_whitespace=False, max_length=16384)
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
        user = find_login_user(attrs["identifier"])

        if not user or not user.is_active or not user.check_password(attrs["password"]):
            raise serializers.ValidationError(
                "E-poçt, telefon və ya şifrə yanlışdır."
            )
        attrs["user"] = user
        return attrs


class RegistrationSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField(max_length=254, error_messages={"invalid": "Düzgün e-poçt ünvanı daxil edin.", "blank": "E-poçt ünvanını daxil edin.", "required": "E-poçt ünvanını daxil edin."})
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
                "+994 ölkə kodu və düzgün Azərbaycan mobil prefiksi ilə 9 rəqəm daxil edin."
            )
        national_number = phone[4:]
        if (
            len(set(national_number)) == 1
            or national_number in "01234567890123456789"
            or national_number in "98765432109876543210"
        ):
            raise serializers.ValidationError(
                "Telefon nömrəsinin bütün rəqəmləri eyni və ya ardıcıl ola bilməz."
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
    email = serializers.EmailField(max_length=254, error_messages={"invalid": "Düzgün e-poçt ünvanı daxil edin.", "blank": "E-poçt ünvanını daxil edin.", "required": "E-poçt ünvanını daxil edin."})
    code = serializers.RegexField(r"^\d{4}$")

    def validate_email(self, value):
        return value.strip().casefold()


class VerificationResendSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254, error_messages={"invalid": "Düzgün e-poçt ünvanı daxil edin.", "blank": "E-poçt ünvanını daxil edin.", "required": "E-poçt ünvanını daxil edin."})
    purpose = serializers.ChoiceField(choices=("registration", "password_reset"))

    def validate_email(self, value):
        return value.strip().casefold()


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254, error_messages={"invalid": "Düzgün e-poçt ünvanı daxil edin.", "blank": "E-poçt ünvanını daxil edin.", "required": "E-poçt ünvanını daxil edin."})

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
