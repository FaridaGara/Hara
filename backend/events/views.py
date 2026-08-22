from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
)
from rest_framework import status
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.generics import (
    ListAPIView,
    ListCreateAPIView,
    RetrieveAPIView,
    RetrieveDestroyAPIView,
    RetrieveUpdateDestroyAPIView,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ticketing.inventory import annotate_inventory
from ticketing.models import TicketType

from .models import (
    Event,
    Favorite,
    EventPhoto,
    Notification,
    OrganizerFollow,
    Venue,
    VenuePlan,
    VenueSeat,
    VenueSection,
)
from .permissions import HasAdminModelPermission, IsOrganizer
from .serializers import (
    EventDetailSerializer,
    EventSeatingPlanSerializer,
    EventSerializer,
    FavoriteCreateSerializer,
    NotificationSerializer,
    OrganizerFollowSerializer,
    OrganizerEventSerializer,
    OrganizerVenueSerializer,
    VenuePlanSerializer,
)


@extend_schema_view(
    get=extend_schema(
        operation_id="event_list",
        auth=[],
        description="Published events. No authentication is required.",
        parameters=[
            OpenApiParameter(
                "category",
                str,
                description="Category slug.",
            ),
            OpenApiParameter(
                "city",
                str,
                description="Case-insensitive venue city.",
            ),
            OpenApiParameter(
                "featured",
                str,
                enum=["true", "false"],
                description="Filter by featured status.",
            ),
        ],
        responses={200: EventSerializer(many=True)},
    )
)
class EventListAPIView(ListAPIView):
    serializer_class = EventSerializer
    permission_classes = [AllowAny]

    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = [
        "title",
        "description",
        "category__name",
        "venue__name",
        "venue__city",
    ]
    ordering_fields = ["start_at", "created_at"]
    ordering = ["start_at"]

    def get_queryset(self):
        queryset = (
            Event.objects
            .filter(
                status=Event.Status.PUBLISHED,
                category__is_active=True,
                venue__is_active=True,
            )
            .select_related("category", "venue", "organizer")
        )

        category = self.request.query_params.get("category")
        city = self.request.query_params.get("city")
        featured = self.request.query_params.get("featured")

        if category:
            queryset = queryset.filter(category__slug=category)

        if city:
            queryset = queryset.filter(venue__city__iexact=city)

        if featured in {"true", "false"}:
            queryset = queryset.filter(is_featured=featured == "true")

        return queryset


@extend_schema_view(
    get=extend_schema(
        operation_id="event_detail",
        auth=[],
        description="Published event detail. Draft events return 404.",
        responses={
            200: EventDetailSerializer,
            404: OpenApiResponse(description="Event not found."),
        },
    )
)
class EventDetailAPIView(RetrieveAPIView):
    serializer_class = EventDetailSerializer
    permission_classes = [AllowAny]
    lookup_field = "slug"

    def get_ticket_contract_now(self):
        if not hasattr(self, "_ticket_contract_now"):
            self._ticket_contract_now = timezone.now()

        return self._ticket_contract_now

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["ticket_contract_now"] = (
            self.get_ticket_contract_now()
        )
        return context

    def get_queryset(self):
        ticket_types = annotate_inventory(
            TicketType.objects
            .filter(is_active=True)
            .filter(
                Q(venue_section__isnull=True)
                | Q(venue_section__is_active=True)
            )
            .select_related("event", "venue_section")
            .order_by("price", "id"),
            now=self.get_ticket_contract_now(),
        )
        return (
            Event.objects
            .filter(
                status=Event.Status.PUBLISHED,
                category__is_active=True,
                venue__is_active=True,
            )
            .select_related("category", "venue", "organizer")
            .prefetch_related(
                Prefetch(
                    "photos",
                    queryset=EventPhoto.objects.order_by("sort_order", "id"),
                ),
                Prefetch(
                    "ticket_types",
                    queryset=ticket_types,
                    to_attr="public_ticket_types",
                )
            )
        )


@extend_schema_view(
    get=extend_schema(
        operation_id="event_seating_plan",
        auth=[],
        description=(
            "Published venue plan, sections, seats and event-specific prices."
        ),
        responses={
            200: EventSeatingPlanSerializer,
            404: OpenApiResponse(description="Seating plan not found."),
        },
    )
)
class EventSeatingPlanAPIView(EventDetailAPIView):
    serializer_class = EventSeatingPlanSerializer

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(venue_plan__status=VenuePlan.Status.PUBLISHED)
            .select_related("venue_plan")
            .prefetch_related(
                Prefetch(
                    "venue_plan__sections",
                    queryset=(
                        VenueSection.objects
                        .filter(is_active=True)
                        .prefetch_related(
                            Prefetch(
                                "seats",
                                queryset=VenueSeat.objects.filter(is_active=True),
                            )
                        )
                    ),
                )
            )
        )


class FavoriteListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="favorite_list",
        description="Events favorited by the authenticated user.",
        responses={200: EventSerializer(many=True)},
    )
    def get(self, request):
        events = (
            Event.objects
            .filter(
                favorite_records__user=request.user,
                status=Event.Status.PUBLISHED,
                category__is_active=True,
                venue__is_active=True,
            )
            .select_related("category", "venue", "organizer")
            .order_by("-favorite_records__created_at")
        )
        return Response(
            EventSerializer(
                events,
                many=True,
                context={"request": request},
            ).data
        )

    @extend_schema(
        operation_id="favorite_create",
        description="Add a published event to the authenticated user's favorites.",
        request=FavoriteCreateSerializer,
        responses={
            200: EventSerializer,
            201: EventSerializer,
            404: OpenApiResponse(description="Published event not found."),
        },
    )
    def post(self, request):
        serializer = FavoriteCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        event = get_object_or_404(
            Event.objects.select_related("category", "venue", "organizer"),
            id=serializer.validated_data["event_id"],
            status=Event.Status.PUBLISHED,
            category__is_active=True,
            venue__is_active=True,
        )
        _, created = Favorite.objects.get_or_create(
            user=request.user,
            event=event,
        )
        return Response(
            EventSerializer(event, context={"request": request}).data,
            status=(
                status.HTTP_201_CREATED
                if created
                else status.HTTP_200_OK
            ),
        )


class FavoriteDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="favorite_delete",
        description="Remove an event from the authenticated user's favorites.",
        responses={204: None},
    )
    def delete(self, request, event_id):
        Favorite.objects.filter(
            user=request.user,
            event_id=event_id,
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class OrganizerFollowAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="organizer_follow",
        description=(
            "Follow an organizer and receive in-app notifications when "
            "they publish a new event."
        ),
        request=OrganizerFollowSerializer,
        responses={200: OrganizerFollowSerializer},
    )
    def post(self, request, organizer_id):
        organizer_model = request.user.__class__
        organizer = get_object_or_404(
            organizer_model.objects.filter(account_type="organizer"),
            id=organizer_id,
        )
        if organizer == request.user:
            return Response(
                {"detail": "Öz hesabınızı izləyə bilməzsiniz."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        OrganizerFollow.objects.get_or_create(
            user=request.user,
            organizer=organizer,
        )
        return Response({"organizer_id": organizer.id, "is_followed": True})

    @extend_schema(
        operation_id="organizer_unfollow",
        description="Stop following an organizer.",
        responses={204: None},
    )
    def delete(self, request, organizer_id):
        OrganizerFollow.objects.filter(
            user=request.user,
            organizer_id=organizer_id,
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationListAPIView(ListAPIView):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="notification_list",
        description="Authenticated user's in-app notifications.",
        responses={200: NotificationSerializer(many=True)},
    )
    def get_queryset(self):
        return (
            Notification.objects
            .filter(user=self.request.user)
            .select_related("event", "organizer")
        )


@extend_schema_view(
    get=extend_schema(
        operation_id="organizer_venue_list",
        description=(
            "Organizer-created venues plus shared legacy venues."
        ),
    ),
    post=extend_schema(
        operation_id="organizer_venue_create",
        description=(
            "Create a venue, optionally with its first versioned seating plan."
        ),
    ),
)
class AdminVenueListCreateAPIView(ListCreateAPIView):
    serializer_class = OrganizerVenueSerializer
    permission_classes = [HasAdminModelPermission]
    permission_resource = "venue"

    def get_queryset(self):
        queryset = Venue.objects.prefetch_related("plans").order_by("name")

        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class AdminVenueDetailAPIView(RetrieveUpdateDestroyAPIView):
    serializer_class = OrganizerVenueSerializer
    permission_classes = [HasAdminModelPermission]
    permission_resource = "venue"
    lookup_field = "id"

    def get_queryset(self):
        return Venue.objects.prefetch_related("plans")

    def destroy(self, request, *args, **kwargs):
        venue = self.get_object()
        if venue.events.exists():
            return Response(
                {
                    "detail": (
                        "Bu məkan tədbirlərdə istifadə olunduğu üçün silinə bilməz."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


class AdminVenuePlanListCreateAPIView(ListCreateAPIView):
    serializer_class = VenuePlanSerializer
    permission_classes = [HasAdminModelPermission]
    permission_resource = "venueplan"

    def get_venue(self):
        return get_object_or_404(
            Venue.objects.all(),
            id=self.kwargs["venue_id"],
        )

    def get_queryset(self):
        return (
            self.get_venue()
            .plans
            .prefetch_related("sections__seats")
            .order_by("-version")
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["venue"] = self.get_venue()
        return context


class AdminVenuePlanDetailAPIView(RetrieveDestroyAPIView):
    serializer_class = VenuePlanSerializer
    permission_classes = [HasAdminModelPermission]
    permission_resource = "venueplan"

    def get_queryset(self):
        queryset = VenuePlan.objects.prefetch_related("sections__seats").filter(
            venue_id=self.kwargs["venue_id"]
        )
        return queryset

    def destroy(self, request, *args, **kwargs):
        plan = self.get_object()
        if plan.events.exists():
            return Response(
                {
                    "detail": (
                        "Bu plan tədbirdə istifadə olunduğu üçün silinə bilməz. "
                        "Yeni versiya yaradın."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


@extend_schema_view(
    get=extend_schema(
        operation_id="organizer_event_list",
        description="Events owned by the authenticated organizer.",
    ),
    post=extend_schema(
        operation_id="organizer_event_create",
        description="Create an event owned by the authenticated organizer.",
    ),
)
class OrganizerEventListCreateAPIView(ListCreateAPIView):
    serializer_class = OrganizerEventSerializer
    permission_classes = [IsOrganizer]

    def get_queryset(self):
        queryset = (
            Event.objects
            .select_related("category", "venue", "organizer")
            .order_by("-created_at")
        )

        if self.request.user.is_superuser:
            return queryset

        return queryset.filter(organizer=self.request.user)

    def perform_create(self, serializer):
        serializer.save(organizer=self.request.user)


@extend_schema_view(
    get=extend_schema(
        operation_id="organizer_event_detail",
        description=(
            "Organizer-owned event detail. Another organizer's event "
            "returns 404."
        ),
    ),
    put=extend_schema(
        operation_id="organizer_event_update",
        responses={
            200: OrganizerEventSerializer,
            409: OpenApiResponse(
                description="Ticketed event is lifecycle-locked."
            ),
        },
    ),
    patch=extend_schema(
        operation_id="organizer_event_partial_update",
        responses={
            200: OrganizerEventSerializer,
            409: OpenApiResponse(
                description="Ticketed event is lifecycle-locked."
            ),
        },
    ),
    delete=extend_schema(
        operation_id="organizer_event_delete",
        responses={
            204: None,
            409: OpenApiResponse(
                description="Ticketed event cannot be deleted."
            ),
        },
    ),
)
class OrganizerEventDetailAPIView(RetrieveUpdateDestroyAPIView):
    serializer_class = OrganizerEventSerializer
    permission_classes = [IsOrganizer]
    lookup_field = "slug"

    def get_queryset(self):
        queryset = (
            Event.objects
            .select_related("category", "venue", "organizer")
        )

        if self.request.user.is_superuser:
            return queryset

        return queryset.filter(organizer=self.request.user)

    @staticmethod
    def has_ticket_sales(event):
        return event.tickets.exists()

    def update(self, request, *args, **kwargs):
        event = self.get_object()

        if self.has_ticket_sales(event):
            return Response(
                {
                    "detail": (
                        "Bu tədbir üçün bilet satıldığına görə "
                        "tədbiri dəyişmək mümkün deyil."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        event = self.get_object()

        # Refunded/cancelled biletlər də audit tarixçəsi kimi saxlanılır.
        if event.tickets.exists():
            return Response(
                {
                    "detail": (
                        "Bu tədbir üçün bilet yaradıldığına görə "
                        "tədbiri silmək mümkün deyil. Tədbir yalnız "
                        "ləğv edilə bilər."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        return super().destroy(request, *args, **kwargs)
