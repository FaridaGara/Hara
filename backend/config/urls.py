"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularSwaggerView,
)
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)
from events.views import (
    OrganizerEventDetailAPIView,
    OrganizerEventListCreateAPIView,
)
from ticketing.views import (
    OrderCancelAPIView,
    OrderCreateAPIView,
    OrderDetailAPIView,
    OrganizerTicketCheckInAPIView,
    OrganizerTicketTypeDetailAPIView,
    OrganizerTicketTypeListCreateAPIView,
    PaymentInitiateAPIView,
    SandboxPaymentCompleteAPIView,
    SandboxPaymentWebhookAPIView,
    TicketDetailAPIView,
    TicketListAPIView,
)

def health_check(request):
    return JsonResponse({
        "status": "ok",
        "service": "HARA Backend API",
    })

urlpatterns = [
    path("", health_check, name="health-check"),
    path("admin/", admin.site.urls),
    path(
        "api/schema/",
        SpectacularAPIView.as_view(),
        name="api-schema",
    ),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="api-schema"),
        name="api-docs",
    ),
    path("api/", include("apps.core.urls")),
    path("api/events/", include("events.urls")),
    path(
        "api/auth/login/",
        TokenObtainPairView.as_view(),
        name="auth-login",
    ),
    path(
        "api/auth/refresh/",
        TokenRefreshView.as_view(),
        name="auth-refresh",
    ),
    path(
        "api/organizer/events/",
        OrganizerEventListCreateAPIView.as_view(),
        name="organizer-event-list",
    ),
    path(
        "api/organizer/events/<slug:slug>/",
        OrganizerEventDetailAPIView.as_view(),
        name="organizer-event-detail",
    ),
    path(
        "api/organizer/events/<slug:event_slug>/ticket-types/",
        OrganizerTicketTypeListCreateAPIView.as_view(),
        name="organizer-ticket-type-list",
    ),
    path(
        "api/organizer/events/<slug:event_slug>/ticket-types/<int:pk>/",
        OrganizerTicketTypeDetailAPIView.as_view(),
        name="organizer-ticket-type-detail",
    ),
    path(
        "api/organizer/events/<slug:event_slug>/check-ins/",
        OrganizerTicketCheckInAPIView.as_view(),
        name="organizer-ticket-check-in",
    ),
    path(
        "api/tickets/",
        TicketListAPIView.as_view(),
        name="ticket-list",
    ),
    path(
        "api/tickets/<uuid:ticket_id>/",
        TicketDetailAPIView.as_view(),
        name="ticket-detail",
    ),
    path(
        "api/orders/",
        OrderCreateAPIView.as_view(),
        name="order-create",
    ),
    path(
        "api/orders/<uuid:order_id>/",
        OrderDetailAPIView.as_view(),
        name="order-detail",
    ),
    path(
        "api/orders/<uuid:order_id>/cancel/",
        OrderCancelAPIView.as_view(),
        name="order-cancel",
    ),
    path(
        "api/orders/<uuid:order_id>/payments/",
        PaymentInitiateAPIView.as_view(),
        name="payment-initiate",
    ),
    path(
        "api/payments/sandbox/<uuid:payment_id>/complete/",
        SandboxPaymentCompleteAPIView.as_view(),
        name="sandbox-payment-complete",
    ),
    path(
        "api/payments/webhook/sandbox/",
        SandboxPaymentWebhookAPIView.as_view(),
        name="sandbox-payment-webhook",
    ),
]
