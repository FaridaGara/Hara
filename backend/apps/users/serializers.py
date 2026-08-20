from rest_framework import serializers

from .models import User


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
        )
        read_only_fields = (
            "id",
            "email",
            "account_type",
            "role",
            "providers",
        )

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
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
