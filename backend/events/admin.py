from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from .models import Category, Event, Venue


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name",)
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Venue)
class VenueAdmin(GISModelAdmin):
    list_display = ("name", "city", "address", "is_active")
    list_filter = ("city", "is_active")
    search_fields = ("name", "city", "address")

    gis_widget_kwargs = {
        "attrs": {
            "default_lat": 40.4093,
            "default_lon": 49.8671,
            "default_zoom": 11,
        }
    }


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "category",
        "venue",
        "start_at",
        "status",
        "is_featured",
    )
    list_filter = ("status", "category", "is_featured")
    search_fields = (
        "title",
        "description",
        "organizer__email",
        "venue__name",
    )
    autocomplete_fields = ("organizer", "category", "venue")
    readonly_fields = ("slug", "created_at", "updated_at")
    date_hierarchy = "start_at"