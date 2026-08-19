from django.contrib.gis.geos import Point
from django.db import transaction
from django.db.models import Max
from rest_framework import serializers

from ticketing.serializers import PublicTicketTypeSerializer

from .models import (
    Category,
    Event,
    Venue,
    VenuePlan,
    VenueSeat,
    VenueSection,
)


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


class VenueSeatSerializer(serializers.ModelSerializer):
    class Meta:
        model = VenueSeat
        fields = (
            "id",
            "row_label",
            "seat_number",
            "x",
            "y",
            "is_accessible",
            "is_active",
        )
        read_only_fields = ("id",)


class VenueSectionSerializer(serializers.ModelSerializer):
    seats = VenueSeatSerializer(many=True, required=False)

    class Meta:
        model = VenueSection
        fields = (
            "id",
            "code",
            "name",
            "seating_type",
            "color",
            "capacity",
            "geometry",
            "sort_order",
            "is_active",
            "seats",
        )
        read_only_fields = ("id",)

    def validate(self, attrs):
        seats = attrs.get("seats", [])
        seating_type = attrs.get(
            "seating_type",
            VenueSection.SeatingType.GENERAL_ADMISSION,
        )
        capacity = attrs.get("capacity")

        if seats and seating_type != VenueSection.SeatingType.RESERVED_SEATING:
            raise serializers.ValidationError({
                "seats": (
                    "Oturacaqlar yalnız nömrəli oturacaq zonasına "
                    "əlavə edilə bilər."
                )
            })

        if capacity is not None and len(seats) > capacity:
            raise serializers.ValidationError({
                "capacity": "Zona tutumu daxil edilən oturacaq sayından azdır."
            })

        seat_keys = [
            (
                seat["row_label"].strip().casefold(),
                seat["seat_number"].strip().casefold(),
            )
            for seat in seats
        ]
        if len(seat_keys) != len(set(seat_keys)):
            raise serializers.ValidationError({
                "seats": "Eyni sıra və nömrəli oturacaq təkrar edilə bilməz."
            })

        return attrs


class VenuePlanSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = VenuePlan
        fields = (
            "id",
            "name",
            "version",
            "background_image_url",
            "canvas_width",
            "canvas_height",
            "status",
            "is_default",
            "created_at",
        )
        read_only_fields = fields


class VenuePlanSerializer(serializers.ModelSerializer):
    sections = VenueSectionSerializer(many=True, required=False)

    class Meta:
        model = VenuePlan
        fields = (
            "id",
            "name",
            "version",
            "background_image_url",
            "canvas_width",
            "canvas_height",
            "status",
            "is_default",
            "sections",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "version", "created_at", "updated_at")

    def validate(self, attrs):
        if (
            attrs.get("is_default")
            and attrs.get("status", VenuePlan.Status.DRAFT)
            != VenuePlan.Status.PUBLISHED
        ):
            raise serializers.ValidationError({
                "is_default": "Yalnız yayımlanmış plan əsas plan ola bilər."
            })

        sections = attrs.get("sections", [])
        normalized_codes = [
            section["code"].strip().casefold()
            for section in sections
        ]
        if len(normalized_codes) != len(set(normalized_codes)):
            raise serializers.ValidationError({
                "sections": "Eyni plan daxilində zona kodu təkrar edilə bilməz."
            })

        return attrs

    @transaction.atomic
    def create(self, validated_data):
        venue = self.context["venue"]
        sections_data = validated_data.pop("sections", [])

        Venue.objects.select_for_update().get(pk=venue.pk)
        version = (
            VenuePlan.objects
            .filter(venue=venue)
            .aggregate(max_version=Max("version"))["max_version"]
            or 0
        ) + 1

        if validated_data.get("is_default"):
            VenuePlan.objects.filter(
                venue=venue,
                is_default=True,
            ).update(is_default=False)

        plan = VenuePlan.objects.create(
            venue=venue,
            version=version,
            **validated_data,
        )

        for section_data in sections_data:
            seats_data = section_data.pop("seats", [])
            section = VenueSection.objects.create(
                venue_plan=plan,
                **section_data,
            )
            VenueSeat.objects.bulk_create([
                VenueSeat(section=section, **seat_data)
                for seat_data in seats_data
            ])

        return plan


class OrganizerVenueSerializer(serializers.ModelSerializer):
    latitude = serializers.FloatField(write_only=True, min_value=-90, max_value=90)
    longitude = serializers.FloatField(
        write_only=True,
        min_value=-180,
        max_value=180,
    )
    plan = VenuePlanSerializer(write_only=True, required=False)
    plans = VenuePlanSummarySerializer(many=True, read_only=True)

    class Meta:
        model = Venue
        fields = (
            "id",
            "name",
            "city",
            "address",
            "latitude",
            "longitude",
            "is_active",
            "plan",
            "plans",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "plans", "created_at", "updated_at")

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["latitude"] = instance.location.y if instance.location else None
        data["longitude"] = instance.location.x if instance.location else None
        return data

    @transaction.atomic
    def create(self, validated_data):
        latitude = validated_data.pop("latitude")
        longitude = validated_data.pop("longitude")
        plan_data = validated_data.pop("plan", None)
        venue = Venue.objects.create(
            location=Point(longitude, latitude, srid=4326),
            **validated_data,
        )

        if plan_data:
            plan_serializer = VenuePlanSerializer(
                context={**self.context, "venue": venue}
            )
            plan_serializer.create(plan_data)

        return venue

    def update(self, instance, validated_data):
        validated_data.pop("plan", None)
        latitude = validated_data.pop("latitude", None)
        longitude = validated_data.pop("longitude", None)

        if latitude is not None or longitude is not None:
            instance.location = Point(
                longitude if longitude is not None else instance.location.x,
                latitude if latitude is not None else instance.location.y,
                srid=4326,
            )

        return super().update(instance, validated_data)


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
    venue_plan_id = serializers.UUIDField(read_only=True)
    ticket_types = PublicTicketTypeSerializer(
        source="public_ticket_types",
        many=True,
        read_only=True,
    )

    class Meta(EventSerializer.Meta):
        fields = EventSerializer.Meta.fields + (
            "venue_plan_id",
            "ticket_types",
        )


class EventSeatingPlanSerializer(serializers.Serializer):
    event_id = serializers.UUIDField(source="id", read_only=True)
    event_slug = serializers.CharField(source="slug", read_only=True)
    venue = VenueSerializer(read_only=True)
    plan = VenuePlanSerializer(source="venue_plan", read_only=True)
    ticket_types = PublicTicketTypeSerializer(
        source="public_ticket_types",
        many=True,
        read_only=True,
    )


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
    venue_plan_id = serializers.PrimaryKeyRelatedField(
        source="venue_plan",
        queryset=VenuePlan.objects.select_related("venue"),
        required=False,
        allow_null=True,
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
            "venue_plan_id",
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
        venue = attrs.get(
            "venue",
            getattr(self.instance, "venue", None),
        )
        venue_plan = attrs.get(
            "venue_plan",
            getattr(self.instance, "venue_plan", None),
        )
        event_status = attrs.get(
            "status",
            getattr(self.instance, "status", Event.Status.DRAFT),
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

        if venue_plan and venue and venue_plan.venue_id != venue.id:
            raise serializers.ValidationError({
                "venue_plan_id": "Seçilən plan tədbirin məkanına aid deyil."
            })

        if (
            venue_plan
            and event_status == Event.Status.PUBLISHED
            and venue_plan.status != VenuePlan.Status.PUBLISHED
        ):
            raise serializers.ValidationError({
                "venue_plan_id": (
                    "Yayımlanmış tədbir yalnız yayımlanmış plan istifadə edə bilər."
                )
            })

        request = self.context.get("request")
        if (
            venue
            and venue.created_by_id
            and request
            and not request.user.is_staff
            and venue.created_by_id != request.user.id
        ):
            raise serializers.ValidationError({
                "venue_id": "Bu məkanı istifadə etmək icazəniz yoxdur."
            })

        if (
            self.instance
            and venue_plan != self.instance.venue_plan
            and self.instance.ticket_types.filter(
                venue_section__isnull=False
            ).exists()
        ):
            raise serializers.ValidationError({
                "venue_plan_id": (
                    "Zona ilə bağlı bilet növləri olduğu üçün plan dəyişdirilə bilməz."
                )
            })

        return attrs
