from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.users.models import LoginRateLimit


class Command(BaseCommand):
    help = "Delete login throttle counters expired for more than one day."

    def handle(self, *args, **options):
        deleted, _ = LoginRateLimit.objects.filter(
            expires_at__lt=timezone.now() - timedelta(days=1),
        ).delete()
        self.stdout.write(f"Deleted {deleted} expired login counters.")
