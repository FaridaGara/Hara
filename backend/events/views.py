from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import AllowAny

from .models import Event
from .serializers import EventSerializer
from rest_framework import status
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.generics import (
    ListAPIView,
    ListCreateAPIView,
    RetrieveAPIView,
    RetrieveUpdateDestroyAPIView,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


from .models import Event
from .permissions import IsOrganizer
from .serializers import EventSerializer, OrganizerEventSerializer


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


class EventDetailAPIView(RetrieveAPIView):
    serializer_class = EventSerializer
    permission_classes = [AllowAny]
    lookup_field = "slug"

    def get_queryset(self):
        return (
            Event.objects
            .filter(
                status=Event.Status.PUBLISHED,
                category__is_active=True,
                venue__is_active=True,
            )
            .select_related("category", "venue", "organizer")
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

        if self.request.user.is_staff:
            return queryset

        return queryset.filter(organizer=self.request.user)

    def perform_create(self, serializer):
        serializer.save(organizer=self.request.user)


class OrganizerEventDetailAPIView(RetrieveUpdateDestroyAPIView):
    serializer_class = OrganizerEventSerializer
    permission_classes = [IsOrganizer]
    lookup_field = "slug"

    def get_queryset(self):
        queryset = (
            Event.objects
            .select_related("category", "venue", "organizer")
        )

        if self.request.user.is_staff:
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