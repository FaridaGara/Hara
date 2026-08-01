from django.core.management.base import BaseCommand, CommandError

from ticketing.orders.expiration import expire_pending_orders


class Command(BaseCommand):
    help = "Müddəti bitmiş pending sifarişləri expired edir."

    def add_arguments(self, parser):
        parser.add_argument(
            "--batch-size",
            type=int,
            default=500,
            help="Bir transaction daxilində emal ediləcək order sayı.",
        )

    def handle(self, *args, **options):
        try:
            result = expire_pending_orders(
                batch_size=options["batch_size"],
            )
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            self.style.SUCCESS(
                (
                    f"Checked {result.checked}; "
                    f"expired {result.expired}; "
                    f"skipped {result.skipped} orders."
                )
            )
        )
