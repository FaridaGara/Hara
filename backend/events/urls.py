from django.urls import path

from .views import (
    EventDetailAPIView,
    EventListAPIView,
    EventSeatingPlanAPIView,
)
    

app_name = "events"

urlpatterns = [
    path("", EventListAPIView.as_view(), name="event-list"),
    path(
        "<slug:slug>/seating-plan/",
        EventSeatingPlanAPIView.as_view(),
        name="event-seating-plan",
    ),
    path("<slug:slug>/", EventDetailAPIView.as_view(), name="event-detail"),
]
