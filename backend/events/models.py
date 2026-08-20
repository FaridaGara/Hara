import uuid

from django.conf import settings
from django.contrib.gis.db import models
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator, RegexValidator
from django.db import transaction
from django.db.models import Max
from django.utils.text import slugify


class Category(models.Model):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=120, unique=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "Categories"

    def __str__(self):
        return self.name


class Venue(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    city = models.CharField(max_length=100, default="Bakı")
    address = models.CharField(max_length=300)
    location = models.PointField(
        srid=4326,
        geography=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_venues",
        null=True,
        blank=True,
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} — {self.city}"


class VenuePlan(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(
        Venue,
        on_delete=models.CASCADE,
        related_name="plans",
    )
    name = models.CharField(max_length=160)
    version = models.PositiveSmallIntegerField(editable=False)
    background_image_url = models.URLField(blank=True)
    canvas_width = models.PositiveIntegerField(
        default=1200,
        validators=[MinValueValidator(1)],
    )
    canvas_height = models.PositiveIntegerField(
        default=900,
        validators=[MinValueValidator(1)],
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["venue", "-version"]
        constraints = [
            models.UniqueConstraint(
                fields=("venue", "version"),
                name="unique_venue_plan_version",
            ),
            models.UniqueConstraint(
                fields=("venue",),
                condition=models.Q(is_default=True),
                name="unique_default_plan_per_venue",
            ),
        ]

    def clean(self):
        if self.is_default and self.status != self.Status.PUBLISHED:
            raise ValidationError({
                "is_default": "Yalnız yayımlanmış plan əsas plan ola bilər."
            })

    def save(self, *args, **kwargs):
        if self._state.adding and not self.version:
            with transaction.atomic():
                Venue.objects.select_for_update().get(pk=self.venue_id)
                self.version = (
                    VenuePlan.objects
                    .filter(venue_id=self.venue_id)
                    .aggregate(max_version=Max("version"))["max_version"]
                    or 0
                ) + 1
                return super().save(*args, **kwargs)

        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.venue.name} — {self.name} v{self.version}"


class VenueSection(models.Model):
    class SeatingType(models.TextChoices):
        GENERAL_ADMISSION = "general_admission", "General admission"
        RESERVED_SEATING = "reserved_seating", "Reserved seating"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue_plan = models.ForeignKey(
        VenuePlan,
        on_delete=models.CASCADE,
        related_name="sections",
    )
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=120)
    seating_type = models.CharField(
        max_length=24,
        choices=SeatingType.choices,
        default=SeatingType.GENERAL_ADMISSION,
    )
    color = models.CharField(
        max_length=7,
        default="#5B5CE2",
        validators=[
            RegexValidator(
                regex=r"^#[0-9A-Fa-f]{6}$",
                message="Rəng #RRGGBB formatında olmalıdır.",
            )
        ],
    )
    capacity = models.PositiveIntegerField(
        validators=[MinValueValidator(1)],
    )
    geometry = models.JSONField(default=dict, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=("venue_plan", "code"),
                name="unique_section_code_per_venue_plan",
            ),
        ]

    def __str__(self):
        return f"{self.venue_plan} — {self.name}"


class VenueSeat(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    section = models.ForeignKey(
        VenueSection,
        on_delete=models.CASCADE,
        related_name="seats",
    )
    row_label = models.CharField(max_length=30)
    seat_number = models.CharField(max_length=30)
    x = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        validators=[MinValueValidator(0)],
    )
    y = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        validators=[MinValueValidator(0)],
    )
    is_accessible = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["row_label", "seat_number"]
        constraints = [
            models.UniqueConstraint(
                fields=("section", "row_label", "seat_number"),
                name="unique_seat_per_section_row",
            ),
        ]

    def clean(self):
        if (
            self.section_id
            and self.section.seating_type
            != VenueSection.SeatingType.RESERVED_SEATING
        ):
            raise ValidationError({
                "section": "Oturacaq yalnız nömrəli oturacaq zonasına əlavə edilə bilər."
            })

    def __str__(self):
        return f"{self.section} — {self.row_label}/{self.seat_number}"


class Event(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        CANCELLED = "cancelled", "Cancelled"
        COMPLETED = "completed", "Completed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="organized_events",
    )
    category = models.ForeignKey(
        Category,
        on_delete=models.PROTECT,
        related_name="events",
    )
    venue = models.ForeignKey(
        Venue,
        on_delete=models.PROTECT,
        related_name="events",
    )
    venue_plan = models.ForeignKey(
        VenuePlan,
        on_delete=models.PROTECT,
        related_name="events",
        null=True,
        blank=True,
    )

    title = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, unique=True, blank=True)
    description = models.TextField()
    cover_image_url = models.URLField(blank=True)

    start_at = models.DateTimeField()
    end_at = models.DateTimeField()

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    is_featured = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["start_at"]
        indexes = [
            models.Index(fields=["status", "start_at"]),
            models.Index(fields=["organizer", "status"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_at__gt=models.F("start_at")),
                name="event_end_after_start",
            ),
        ]

    def clean(self):
        if self.start_at and self.end_at and self.end_at <= self.start_at:
            raise ValidationError({
                "end_at": "Bitmə vaxtı başlama vaxtından sonra olmalıdır."
            })

        if (
            self.venue_plan_id
            and self.venue_id
            and self.venue_plan.venue_id != self.venue_id
        ):
            raise ValidationError({
                "venue_plan": "Seçilən plan tədbirin məkanına aid deyil."
            })

        if (
            self.status == self.Status.PUBLISHED
            and self.venue_plan_id
            and self.venue_plan.status != VenuePlan.Status.PUBLISHED
        ):
            raise ValidationError({
                "venue_plan": "Yayımlanmış tədbir yalnız yayımlanmış plan istifadə edə bilər."
            })

    def save(self, *args, **kwargs):
        if not self.slug:
            base_slug = slugify(self.title)[:220] or str(self.id)
            candidate = base_slug
            counter = 2

            while Event.objects.filter(slug=candidate).exclude(pk=self.pk).exists():
                candidate = f"{base_slug}-{counter}"
                counter += 1

            self.slug = candidate

        super().save(*args, **kwargs)

    def __str__(self):
        return self.title


class Favorite(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="event_favorites",
    )
    event = models.ForeignKey(
        Event,
        on_delete=models.CASCADE,
        related_name="favorite_records",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=("user", "event"),
                name="unique_user_event_favorite",
            ),
        ]

    def __str__(self):
        return f"{self.user} — {self.event}"
