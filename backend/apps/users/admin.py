from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import SocialIdentity, User


class SocialIdentityInline(admin.TabularInline):
    model = SocialIdentity
    extra = 0
    readonly_fields = ("provider", "subject", "created_at", "updated_at")


@admin.register(User)
class HaraUserAdmin(UserAdmin):
    model = User
    inlines = (SocialIdentityInline,)
    ordering = ("email",)
    list_display = (
        "email",
        "display_name",
        "account_type",
        "is_email_verified",
        "is_staff",
        "is_active",
    )
    list_filter = (
        "account_type",
        "is_email_verified",
        "is_staff",
        "is_active",
    )
    search_fields = (
        "email",
        "display_name",
        "first_name",
        "last_name",
        "phone_number",
    )

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        (
            "Profile",
            {
                "fields": (
                    "account_type",
                    "display_name",
                    "first_name",
                    "last_name",
                    "phone_number",
                    "avatar_url",
                    "is_email_verified",
                )
            },
        ),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "password1",
                    "password2",
                    "account_type",
                    "display_name",
                    "phone_number",
                    "is_email_verified",
                    "is_staff",
                    "is_active",
                ),
            },
        ),
    )

    def has_module_permission(self, request):
        return request.user.is_active and request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return request.user.is_active and request.user.is_superuser

    def has_add_permission(self, request):
        return request.user.is_active and request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return request.user.is_active and request.user.is_superuser

    def has_delete_permission(self, request, obj=None):
        return request.user.is_active and request.user.is_superuser
