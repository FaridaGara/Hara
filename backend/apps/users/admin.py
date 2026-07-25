from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class HaraUserAdmin(UserAdmin):
    model = User
    ordering = ("email",)
    list_display = (
        "email",
        "display_name",
        "account_type",
        "is_staff",
        "is_active",
    )
    list_filter = ("account_type", "is_staff", "is_active")
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
                    "is_staff",
                    "is_active",
                ),
            },
        ),
    )
