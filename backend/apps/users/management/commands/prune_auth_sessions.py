from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.users.models import AuthSession


class Command(BaseCommand):
    help = "Delete auth sessions that expired more than one day ago."

    def handle(self, *args, **options):
        deleted, _ = AuthSession.objects.filter(
            expires_at__lt=timezone.now() - timedelta(days=1),
        ).delete()
        self.stdout.write(f"Deleted {deleted} expired auth sessions.")
