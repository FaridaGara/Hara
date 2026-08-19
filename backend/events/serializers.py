from rest_framework import serializers

from ticketing.serializers import PublicTicketTypeSerializer

from .models import Category, Event, Venue


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ("id", "name", "slug")


class VenueSerializer(serializers.ModelSerializer):
    latitude = serializers.SerializerMethodField()
    longitude = serializers.SerializerMethodField()

    class Meta:
        model = Venue
        fields = (
            "id",
            "name",
            "city",
            "address",
            "latitude",
            "longitude",
        )

    def get_latitude(self, obj) -> float | None:
        return obj.location.y if obj.location else None

    def get_longitude(self, obj) -> float | None:
        return obj.location.x if obj.location else None


class EventSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    venue = VenueSerializer(read_only=True)

    class Meta:
        model = Event
        fields = (
            "id",
            "title",
            "slug",
            "description",
            "cover_image_url",
            "category",
            "venue",
            "start_at",
            "end_at",
            "status",
            "is_featured",
        )


class EventDetailSerializer(EventSerializer):
    ticket_types = PublicTicketTypeSerializer(
        source="public_ticket_types",
        many=True,
        read_only=True,
    )

    class Meta(EventSerializer.Meta):
        fields = EventSerializer.Meta.fields + ("ticket_types",)


class FavoriteCreateSerializer(serializers.Serializer):
    event_id = serializers.UUIDField()


class OrganizerEventSerializer(serializers.ModelSerializer):
    category_id = serializers.PrimaryKeyRelatedField(
        source="category",
        queryset=Category.objects.filter(is_active=True),
    )
    venue_id = serializers.PrimaryKeyRelatedField(
        source="venue",
        queryset=Venue.objects.filter(is_active=True),
    )

    class Meta:
        model = Event
        fields = [
            "id",
            "title",
            "slug",
            "description",
            "cover_image_url",
            "category_id",
            "venue_id",
            "start_at",
            "end_at",
            "status",
            "is_featured",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "slug",
            "is_featured",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        start_at = attrs.get(
            "start_at",
            getattr(self.instance, "start_at", None),
        )
        end_at = attrs.get(
            "end_at",
            getattr(self.instance, "end_at", None),
        )

        if start_at and end_at and end_at <= start_at:
            raise serializers.ValidationError(
                {
                    "end_at": (
                        "Tədbirin bitmə vaxtı başlama vaxtından "
                        "sonra olmalıdır."
                    )
                }
            )

        return attrs
