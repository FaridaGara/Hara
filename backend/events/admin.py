from django import forms
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.db import transaction
from rest_framework.exceptions import ValidationError as APIValidationError
from django.contrib.gis.admin import GISModelAdmin

from .models import (
    Category,
    Event,
    EventPhoto,
    EventSubmission,
    Favorite,
    Notification,
    OrganizerFollow,
    Venue,
    VenuePlan,
    VenueSeat,
    VenueSection,
)
from .submissions import validate_snapshot, eligibility, is_free_event


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name",)
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Venue)
class VenueAdmin(GISModelAdmin):
    list_display = (
        "name",
        "city",
        "address",
        "created_by",
        "is_active",
    )
    list_filter = ("city", "is_active")
    search_fields = ("name", "city", "address")

    gis_widget_kwargs = {
        "attrs": {
            "default_lat": 40.4093,
            "default_lon": 49.8671,
            "default_zoom": 11,
        }
    }


@admin.register(VenuePlan)
class VenuePlanAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "venue",
        "version",
        "status",
        "is_default",
    )
    list_filter = ("status", "is_default")
    search_fields = ("name", "venue__name")
    autocomplete_fields = ("venue",)
    readonly_fields = ("version", "created_at", "updated_at")


@admin.register(VenueSection)
class VenueSectionAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "code",
        "venue_plan",
        "seating_type",
        "capacity",
        "is_active",
    )
    list_filter = ("seating_type", "is_active")
    search_fields = ("name", "code", "venue_plan__venue__name")
    autocomplete_fields = ("venue_plan",)


@admin.register(VenueSeat)
class VenueSeatAdmin(admin.ModelAdmin):
    list_display = (
        "section",
        "row_label",
        "seat_number",
        "is_accessible",
        "is_active",
    )
    list_filter = ("is_accessible", "is_active")
    search_fields = (
        "section__name",
        "section__venue_plan__venue__name",
        "row_label",
        "seat_number",
    )
    autocomplete_fields = ("section",)


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "category",
        "venue",
        "venue_plan",
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
    autocomplete_fields = (
        "organizer",
        "category",
        "venue",
        "venue_plan",
    )
    readonly_fields = ("slug", "created_at", "updated_at")
    date_hierarchy = "start_at"


@admin.register(EventPhoto)
class EventPhotoAdmin(admin.ModelAdmin):
    list_display = ("event", "sort_order", "image_url", "created_at")
    search_fields = ("event__title", "image_url")
    autocomplete_fields = ("event",)
    readonly_fields = ("created_at",)


@admin.register(Favorite)
class FavoriteAdmin(admin.ModelAdmin):
    list_display = ("user", "event", "created_at")
    search_fields = ("user__email", "event__title")
    autocomplete_fields = ("user", "event")
    readonly_fields = ("created_at",)
    date_hierarchy = "created_at"


@admin.register(OrganizerFollow)
class OrganizerFollowAdmin(admin.ModelAdmin):
    list_display = ("user", "organizer", "created_at")
    search_fields = ("user__email", "organizer__email")
    autocomplete_fields = ("user", "organizer")
    readonly_fields = ("created_at",)


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("user", "type", "title", "event", "read_at", "created_at")
    list_filter = ("type", "read_at")
    search_fields = ("user__email", "title", "body", "event__title")
    autocomplete_fields = ("user", "event", "organizer")
    readonly_fields = ("created_at",)


class SubmissionAdminForm(forms.ModelForm):
    class Meta:
        model = EventSubmission
        fields = ['status', 'note']

    def clean(self):
        data = super().clean()
        if data.get('status') == 'changes_requested' and not data.get('note', '').strip():
            self.add_error('note', 'Düzəliş səbəbini yaz.')
        if self.instance.pk and self.instance.event.status != 'draft':
            raise ValidationError('Yayımlanmış tədbirin moderasiya qərarı dəyişdirilə bilməz.')
        return data


@admin.register(EventSubmission)
class EventSubmissionAdmin(admin.ModelAdmin):
    form = SubmissionAdminForm
    list_display = ('event', 'owner', 'status', 'created_at')
    list_filter = ('status',)
    search_fields = ('event__title', 'owner__email')
    readonly_fields = ('id', 'owner', 'event', 'snapshot', 'fingerprint', 'created_at', 'updated_at')
    actions = ['approve_and_publish']

    def has_add_permission(self, request): return False
    def has_delete_permission(self, request, obj=None): return False

    @admin.action(description='Yoxlamanı təsdiqlə və yayımla')
    def approve_and_publish(self, request, queryset):
        for pk in queryset.values_list('pk', flat=True):
            try:
                with transaction.atomic():
                    item = EventSubmission.objects.select_for_update().select_related('owner', 'event__venue').get(pk=pk)
                    event = Event.objects.select_for_update().get(pk=item.event_id)
                    if event.status != 'draft' or item.status != 'pending':
                        raise ValidationError('Yalnız yoxlanılan qaralama yayımlana bilər.')
                    gate = eligibility(item.owner, free_event=is_free_event(item.snapshot) and not event.ticket_types.exclude(price=0).exists())
                    if not gate['eligible']: raise ValidationError(gate['detail'])
                    validate_snapshot(item.snapshot)
                    if event.venue_plan_id:
                        VenuePlan.objects.filter(pk=event.venue_plan_id).update(status='published')
                    event.venue.is_active = True
                    event.venue.save(update_fields=['is_active'])
                    event.status = 'published'
                    event.full_clean()
                    event.save(update_fields=['status', 'published_at', 'updated_at'])
                    self.log_change(request, item, 'Tədbir moderasiyadan sonra yayımlandı.')
            except (ValidationError, APIValidationError) as error:
                self.message_user(request, f'{pk}: {error}', level='ERROR')
            else:
                self.message_user(request, f'{event.title}: yayımlandı.')
