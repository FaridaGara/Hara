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
    TokenRefreshView,
)
from apps.users.views import (
    AppleSocialLoginAPIView,
    CredentialsLoginAPIView,
    EmailVerificationAPIView,
    GoogleSocialLoginAPIView,
    PasswordResetConfirmAPIView,
    PasswordResetRequestAPIView,
    PasswordResetVerifyAPIView,
    RegistrationAPIView,
    UserProfileAPIView,
    VerificationResendAPIView,
)
from events.views import (
    AdminVenueDetailAPIView,
    AdminVenueListCreateAPIView,
    AdminVenuePlanDetailAPIView,
    AdminVenuePlanListCreateAPIView,
    FavoriteDetailAPIView,
    FavoriteListCreateAPIView,
    NotificationListAPIView,
    OrganizerFollowAPIView,
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
        "api/favorites/",
        FavoriteListCreateAPIView.as_view(),
        name="favorite-list",
    ),
    path(
        "api/favorites/<uuid:event_id>/",
        FavoriteDetailAPIView.as_view(),
        name="favorite-detail",
    ),
    path(
        "api/organizers/<int:organizer_id>/follow/",
        OrganizerFollowAPIView.as_view(),
        name="organizer-follow",
    ),
    path(
        "api/notifications/",
        NotificationListAPIView.as_view(),
        name="notification-list",
    ),
    path(
        "api/auth/login/",
        CredentialsLoginAPIView.as_view(),
        name="auth-login",
    ),
    path(
        "api/auth/register/",
        RegistrationAPIView.as_view(),
        name="auth-register",
    ),
    path(
        "api/auth/verify-email/",
        EmailVerificationAPIView.as_view(),
        name="auth-verify-email",
    ),
    path(
        "api/auth/verification/resend/",
        VerificationResendAPIView.as_view(),
        name="auth-verification-resend",
    ),
    path(
        "api/auth/password-reset/request/",
        PasswordResetRequestAPIView.as_view(),
        name="auth-password-reset-request",
    ),
    path(
        "api/auth/password-reset/verify/",
        PasswordResetVerifyAPIView.as_view(),
        name="auth-password-reset-verify",
    ),
    path(
        "api/auth/password-reset/confirm/",
        PasswordResetConfirmAPIView.as_view(),
        name="auth-password-reset-confirm",
    ),
    path(
        "api/auth/refresh/",
        TokenRefreshView.as_view(),
        name="auth-refresh",
    ),
    path(
        "api/auth/social/google/",
        GoogleSocialLoginAPIView.as_view(),
        name="auth-google",
    ),
    path(
        "api/auth/social/apple/",
        AppleSocialLoginAPIView.as_view(),
        name="auth-apple",
    ),
    path(
        "api/auth/me/",
        UserProfileAPIView.as_view(),
        name="auth-profile",
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
        "api/admin/venues/",
        AdminVenueListCreateAPIView.as_view(),
        name="admin-venue-list",
    ),
    path(
        "api/admin/venues/<uuid:id>/",
        AdminVenueDetailAPIView.as_view(),
        name="admin-venue-detail",
    ),
    path(
        "api/admin/venues/<uuid:venue_id>/plans/",
        AdminVenuePlanListCreateAPIView.as_view(),
        name="admin-venue-plan-list",
    ),
    path(
        "api/admin/venues/<uuid:venue_id>/plans/<uuid:pk>/",
        AdminVenuePlanDetailAPIView.as_view(),
        name="admin-venue-plan-detail",
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
